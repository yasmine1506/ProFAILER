// ══════════════════════════════════════════════════════════════════════════
//  logstore.js — reliable research-log storage for the DEER room
//
//  Layers (an event is "acknowledged" to the browser only after layers 1+2):
//    1. memory            (fast lookups, dedupe by event id)
//    2. local disk        (append-only <DATA_DIR>/<session>.jsonl, written synchronously)
//    3. private GitHub gist (debounced push, retried until it succeeds; flushed on reset/exit)
//  Browsers keep re-sending anything that was not acknowledged, and keep their own copy too.
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const P1_COLS = ['session','puzzle','seq','ts','elapsed_s','puzzle_elapsed_s','player','phase','task','event','attempt','round','item',
                 'choice','choice_label','correct','cup_pct','book_pct','bias_score','books','mugs','detail'];
const P2_COLS = ['session','puzzle','seq','ts','elapsed_s','puzzle_elapsed_s','player','phase','task','event','tx','attempt','item',
                 'choice','correct','positions','score','tier','step_probs','verdict','repeat','detail'];
const ALL_COLS = [...new Set([...P1_COLS, ...P2_COLS])];
const COLS = { p1: P1_COLS, p2: P2_COLS };
const SUMMARY_COLS = [
  'session_id','mode','session_start','session_end','session_duration_sec','ended_by','puzzles_included','all_puzzles_completed',
  'p1_included','p1_start','p1_end','p1_duration_sec','p1_completed','p1_force_advanced',
  'p1_phase1_training_attempts','p1_phase1_scan_attempts','p1_phase2_complete','p1_rows',
  'p2_included','p2_start','p2_end','p2_duration_sec','p2_completed','p2_force_advanced',
  'p2_phase1_attempts_total','p2_phase1_tx1_attempts','p2_phase1_tx2_attempts',
  'p2_phase2_tx1_attempts','p2_phase2_tx2_attempts','p2_result','p2_rows'
];

function csvCell(v) {
  if (v === undefined || v === null) return '';
  v = String(v);
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function toCsv(cols, rows) {
  return cols.join(',') + '\n' + rows.map(r => cols.map(c => csvCell(r[c])).join(',')).join('\n') + '\n';
}
const iso = ms => (ms == null ? '' : new Date(ms).toISOString());
const secs = (a, b) => (a == null || b == null ? '' : Math.round((b - a) / 100) / 10);

class LogStore {
  /**
   * opts: { dataDir, gistId, gistToken, apiBase, prefix, flushDelayMs, log }
   */
  constructor(opts = {}) {
    this.dataDir = opts.dataDir || path.join(__dirname, 'data');
    this.gistId = opts.gistId || '';
    this.gistToken = opts.gistToken || '';
    this.apiBase = (opts.apiBase || 'https://api.github.com').replace(/\/$/, '');
    this.prefix = opts.prefix || 'S';
    this.flushDelayMs = opts.flushDelayMs != null ? opts.flushDelayMs : 5000;
    this.log = opts.log || console.log;
    this.sessions = new Map();     // id -> { id, events:{p1:Map,p2:Map}, room:Map(key->ev), version, savedVersion }
    this.nextNum = 1;
    this.idIndex = new Map();      // 'p1:<event id>' -> session id (an event lives in exactly one session)
    this.bootstrapped = !this.gistConfigured();   // if no gist, nothing to wait for
    this.gist = { configured: this.gistConfigured(), lastSaved: null, lastError: null, failures: 0, saving: false };
    this._timer = null;
    this.enabled = true;          // admin 'test mode' switch: when false nothing new is recorded
    this.testCount = 0;
    try { fs.mkdirSync(this.dataDir, { recursive: true }); } catch (e) { this.log('LogStore: cannot create data dir:', e.message); }
    this._loadDisk();
  }

  gistConfigured() { return !!(this.gistId && this.gistToken); }

  // ── sessions ─────────────────────────────────────────────────────────────
  _session(id) {
    let s = this.sessions.get(id);
    if (!s) {
      s = { id, events: { p1: new Map(), p2: new Map() }, room: new Map(), moved: new Set(), version: 0, savedVersion: 0 };
      this.sessions.set(id, s);
      const m = new RegExp('^' + this.prefix + '(\\d+)$').exec(id);
      if (m) this.nextNum = Math.max(this.nextNum, parseInt(m[1], 10) + 1);
    }
    return s;
  }

  newSessionId() {
    // If a gist is configured but we could not read it yet, a sequential number could collide with an
    // existing gist file and overwrite it — use a timestamp id instead (never collides).
    if (!this.bootstrapped) {
      const d = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      return this.prefix + 'T' + d;
    }
    const id = this.prefix + this.nextNum;
    this.nextNum++;
    return id;
  }

  /**
   * Allocate the next session id. First re-reads the gist (another server instance may have used a number),
   * then publishes the new session to the gist right away so the number is reserved.
   */
  async startSession(puzzles) {
    if (!this.enabled) return 'TEST-' + (++this.testCount);       // test run: no number is used, nothing is stored
    if (this.gistConfigured() && this.bootstrapped) {
      try { await this.mergeFromGist(); } catch (e) { this.log('LogStore: could not re-read gist before numbering:', e.message); }
    }
    const id = this.newSessionId();
    this.addRoomEvent(id, { event: 'session_start', puzzles: (puzzles || []).join(';') });
    if (this.gistConfigured()) { try { await this.flush(); } catch (e) {} }
    return id;
  }

  // ── ingestion ────────────────────────────────────────────────────────────
  /** returns the list of event ids now safely stored (new or already known) */
  addEvents(puzzle, events) {
    if (puzzle !== 'p1' && puzzle !== 'p2') return [];
    const acked = [];
    const lines = {};
    for (const e of events || []) {
      if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id) continue;
      const sid = typeof e.session === 'string' && e.session ? e.session : 'UNASSIGNED';
      const key = puzzle + ':' + e.id;
      // Test mode: acknowledge (so browsers stop re-sending) but store nothing — except late rows of a real session that already exists
      if (!this.enabled && !(this.sessions.has(sid) && !this._isEmpty(sid))) { acked.push(e.id); continue; }
      const known = this.idIndex.get(key);
      if (known && known !== sid) {
        // the browser re-labelled this event (it learned the room's session id after a first send): MOVE it, never duplicate it
        const old = this.sessions.get(known);
        if (old) { old.events[puzzle].delete(e.id); old.moved.add(key); old.version++; (lines[known] = lines[known] || []).push(JSON.stringify({ t: 'x', puzzle, id: e.id })); }
        this.idIndex.delete(key);
      }
      const s = this._session(sid);
      if (!this.idIndex.has(key) && !s.moved.has(key)) {
        const rec = Object.assign({}, e, { session: sid });
        s.events[puzzle].set(e.id, rec);
        this.idIndex.set(key, sid);
        s.version++;
        (lines[sid] = lines[sid] || []).push(JSON.stringify({ t: 'e', puzzle, e: rec }));
      }
      acked.push(e.id);
    }
    this._appendDisk(lines);          // synchronous — only then do we acknowledge
    this._scheduleFlush();
    return acked;
  }

  addRoomEvent(sessionId, ev) {
    if (!sessionId || !ev || !ev.event) return false;
    if (!this.enabled && !(this.sessions.has(sessionId) && !this._isEmpty(sessionId))) return false;
    const s = this._session(sessionId);
    const key = [ev.event, ev.puzzle || '', ev.role || ''].join('|');
    if (s.room.has(key)) return false;                         // first report wins (several screens may report)
    const rec = Object.assign({}, ev, { key, ts: ev.ts || Date.now() });   // server clock for room events
    s.room.set(key, rec);
    s.version++;
    this._appendDisk({ [sessionId]: [JSON.stringify({ t: 'r', r: rec })] });
    this._scheduleFlush();
    return true;
  }

  // ── disk ─────────────────────────────────────────────────────────────────
  _appendDisk(linesBySession) {
    for (const sid of Object.keys(linesBySession)) {
      try { fs.appendFileSync(path.join(this.dataDir, sid + '.jsonl'), linesBySession[sid].join('\n') + '\n'); }
      catch (e) { this.log('LogStore: disk write failed:', e.message); }
    }
  }
  _loadDisk() {
    try {
      for (const f of fs.readdirSync(this.dataDir)) {
        if (!f.endsWith('.jsonl')) continue;
        const sid = f.slice(0, -6);
        const text = fs.readFileSync(path.join(this.dataDir, f), 'utf8');
        this._loadJsonl(sid, text);
      }
      // everything loaded from disk may not be in the gist yet
      for (const s of this.sessions.values()) s.savedVersion = 0;
    } catch (e) { /* first run */ }
  }
  /** Merge one session file (disk or gist) into memory. Returns the number of records it contained. */
  _loadJsonl(sid, text) {
    const recs = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { recs.push(JSON.parse(line)); } catch { /* skip a torn line */ }
    }
    const s = this._session(sid);
    for (const o of recs) if (o.t === 'x' && o.id && (o.puzzle === 'p1' || o.puzzle === 'p2')) {
      const key = o.puzzle + ':' + o.id;
      if (!s.moved.has(key)) { s.moved.add(key); s.version++; }
      if (s.events[o.puzzle].delete(o.id)) { if (this.idIndex.get(key) === sid) this.idIndex.delete(key); }
    }
    for (const o of recs) {
      if (o.t === 'r' && o.r && o.r.key) {
        if (!s.room.has(o.r.key)) { s.room.set(o.r.key, o.r); s.version++; }
      } else if (o.t === 'e' && o.e && o.e.id && (o.puzzle === 'p1' || o.puzzle === 'p2')) {
        const key = o.puzzle + ':' + o.e.id;
        if (s.moved.has(key)) continue;
        const real = o.e.session || sid;
        const target = real === sid ? s : this._session(real);
        const have = this.idIndex.get(key);
        if (have && have !== real) continue;                 // already stored under another session — keep the first
        if (!target.events[o.puzzle].has(o.e.id)) { target.events[o.puzzle].set(o.e.id, o.e); this.idIndex.set(key, real); target.version++; }
      }
    }
    return recs.length;
  }
  _recordCount(s) { return s.events.p1.size + s.events.p2.size + s.room.size + s.moved.size; }

  // ── rows & exports ───────────────────────────────────────────────────────
  _times(s) {
    const r = k => { const e = s.room.get(k); return e ? e.ts : null; };
    let first = Infinity, last = -Infinity;
    for (const p of ['p1', 'p2']) for (const e of s.events[p].values()) { const t = Date.parse(e.ts); if (!isNaN(t)) { first = Math.min(first, t); last = Math.max(last, t); } }
    for (const e of s.room.values()) { first = Math.min(first, e.ts); last = Math.max(last, e.ts); }
    return { r, first: isFinite(first) ? first : null, last: isFinite(last) ? last : null };
  }

  rows(sessionId, puzzle) {
    const s = this.sessions.get(sessionId);
    if (!s) return [];
    const T = this._times(s);
    const t0 = T.r('session_start||') || T.first;
    const pStart = T.r('puzzle_start|' + (puzzle === 'p1' ? 1 : 2) + '|');
    const list = [...s.events[puzzle].values()].sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : (a.id < b.id ? -1 : 1));
    const known = new Set(COLS[puzzle]);
    return list.map((e, i) => {
      const row = { session: sessionId, puzzle: puzzle === 'p1' ? 1 : 2, seq: i + 1,
                    elapsed_s: secs(t0, Date.parse(e.ts)), puzzle_elapsed_s: pStart ? secs(pStart, Date.parse(e.ts)) : '' };
      const detail = {};
      for (const k of Object.keys(e)) {
        if (k === 'id' || k === 'session') continue;
        if (known.has(k) && !(k in row)) row[k] = e[k];
        else if (!known.has(k)) detail[k.replace(/^detail_/, '')] = e[k];
      }
      row.detail = Object.keys(detail).length ? JSON.stringify(detail) : '';
      return row;
    });
  }

  eventsCsv(sessionIds, puzzle /* 'p1' | 'p2' | 'all' */) {
    const ids = sessionIds === 'all' ? [...this.sessions.keys()].sort(cmpSession) : sessionIds;
    if (puzzle === 'p1' || puzzle === 'p2') {
      const rows = ids.flatMap(id => this.rows(id, puzzle));
      return toCsv(COLS[puzzle], rows);
    }
    const rows = ids.flatMap(id => [...this.rows(id, 'p1'), ...this.rows(id, 'p2')]);
    return toCsv(ALL_COLS, rows);
  }

  summaryRow(sessionId) {
    const s = this.sessions.get(sessionId);
    const T = this._times(s);
    const room = k => { const e = s.room.get(k); return e || null; };
    const start = room('session_start||');
    const complete = room('session_complete||'), reset = room('session_reset||');
    const tStart = start ? start.ts : T.first;
    const tEnd = complete ? complete.ts : reset ? reset.ts : T.last;
    const row = { session_id: sessionId, mode: start ? 'room' : 'standalone',
      session_start: iso(tStart), session_end: iso(tEnd), session_duration_sec: secs(tStart, tEnd),
      ended_by: complete ? 'complete' : reset ? 'reset' : 'last_event',
      puzzles_included: start ? (start.puzzles || '') : [s.events.p1.size ? '1' : '', s.events.p2.size ? '2' : ''].filter(Boolean).join(';') };
    const included = (row.puzzles_included || '').split(';').filter(Boolean);
    let allDone = included.length > 0;
    for (const n of [1, 2]) {
      const key = 'p' + n, inc = included.includes(String(n)) || s.events[key].size > 0;
      row[key + '_included'] = inc ? 1 : 0;
      const ps = room('puzzle_start|' + n + '|'), pe = room('puzzle_end|' + n + '|');
      if (inc) {
        let lastEv = null; for (const e of s.events[key].values()) { const t = Date.parse(e.ts); if (lastEv === null || t > lastEv) lastEv = t; }
        row[key + '_start'] = iso(ps ? ps.ts : null);
        row[key + '_end'] = iso(pe ? pe.ts : null);
        row[key + '_duration_sec'] = ps ? secs(ps.ts, pe ? pe.ts : lastEv) : '';
        // completed = the puzzle itself reported success (or the room recorded completion) — even if the admin then force-advanced
        const solved = n === 1 ? [...s.events.p1.values()].some(e => e.event === 'puzzle1_complete')
                               : [...s.events.p2.values()].some(e => e.event === 'send_transmission' && e.phase === 2 && e.tx === 2 && e.detail_result === 'win');
        const done = (pe && pe.how === 'complete') || solved;
        row[key + '_completed'] = done ? 1 : 0;
        row[key + '_force_advanced'] = pe && pe.how === 'force' ? 1 : 0;
        if (!done) allDone = false;
      }
      row[key + '_rows'] = s.events[key].size;
    }
    row.all_puzzles_completed = allDone ? 1 : 0;
    const ev1 = [...s.events.p1.values()], ev2 = [...s.events.p2.values()];
    row.p1_phase1_training_attempts = ev1.filter(e => e.task === 'train' && e.event === 'train_model').length;
    row.p1_phase1_scan_attempts = ev1.filter(e => e.task === 'scan' && e.event === 'scan').length;
    row.p1_phase2_complete = ev1.some(e => e.event === 'puzzle1_complete') ? 1 : 0;
    const seqs = ev2.filter(e => e.task === 'response_sequence' && e.event === 'submit');
    const cnt = (ph, tx) => seqs.filter(e => e.phase === ph && (tx == null || e.tx === tx)).length;
    row.p2_phase1_attempts_total = cnt(1); row.p2_phase1_tx1_attempts = cnt(1, 1); row.p2_phase1_tx2_attempts = cnt(1, 2);
    row.p2_phase2_tx1_attempts = cnt(2, 1); row.p2_phase2_tx2_attempts = cnt(2, 2);
    const fin = ev2.find(e => e.event === 'send_transmission' && e.phase === 2 && e.tx === 2);
    row.p2_result = fin && fin.detail_result ? fin.detail_result : '';
    return row;
  }

  _isEmpty(id) { const s = this.sessions.get(id); return !s || (!s.events.p1.size && !s.events.p2.size && !s.room.size); }

  summaryCsv(sessionIds) {
    const ids = !sessionIds || sessionIds === 'all' ? [...this.sessions.keys()].filter(id => !this._isEmpty(id)).sort(cmpSession) : sessionIds;
    return toCsv(SUMMARY_COLS, ids.filter(id => this.sessions.has(id)).map(id => this.summaryRow(id)));
  }

  listSessions() {
    return [...this.sessions.keys()].filter(id => !this._isEmpty(id)).sort(cmpSession).map(id => {
      const r = this.summaryRow(id);
      return { id, mode: r.mode, start: r.session_start, end: r.session_end, rows_p1: r.p1_rows, rows_p2: r.p2_rows,
               all_completed: r.all_puzzles_completed, ended_by: r.ended_by };
    });
  }

  rawJsonl(sessionId) {
    const s = this.sessions.get(sessionId); if (!s) return '';
    const out = [];
    for (const p of ['p1', 'p2']) for (const e of s.events[p].values()) out.push(JSON.stringify({ t: 'e', puzzle: p, e }));
    for (const r of s.room.values()) out.push(JSON.stringify({ t: 'r', r }));
    for (const key of s.moved) { const i = key.indexOf(':'); out.push(JSON.stringify({ t: 'x', puzzle: key.slice(0, i), id: key.slice(i + 1) })); }
    return out.join('\n') + '\n';
  }

  // ── gist ─────────────────────────────────────────────────────────────────
  async _api(method, urlPath, body) {
    const res = await fetch(this.apiBase + urlPath, {
      method,
      headers: { Authorization: 'Bearer ' + this.gistToken, Accept: 'application/vnd.github+json',
                 'User-Agent': 'deer-room-logstore', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error(method + ' ' + urlPath + ' → HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
    return res.json();
  }

  /**
   * Read every <session>.jsonl in the gist and merge it into memory (by event id). Used at start-up, before numbering a
   * new session, and before every save — so two server instances, or a restart, can never overwrite each other's rows.
   */
  async mergeFromGist() {
    const g = await this._api('GET', '/gists/' + this.gistId);
    const remoteCounts = new Map();
    for (const [name, f] of Object.entries(g.files || {})) {
      if (!/\.jsonl$/.test(name)) continue;
      const sid = name.slice(0, -6);
      let text = f.content;
      if (f.truncated || text == null) {
        const r = await fetch(f.raw_url, { headers: { Authorization: 'Bearer ' + this.gistToken, 'User-Agent': 'deer-room-logstore' } });
        if (!r.ok) throw new Error('raw ' + name + ' → HTTP ' + r.status);
        text = await r.text();
      }
      remoteCounts.set(sid, this._loadJsonl(sid, text));
    }
    // A session needs pushing only if we hold more records than the gist does.
    for (const [sid, n] of remoteCounts) {
      const s = this.sessions.get(sid);
      if (this._recordCount(s) <= n) s.savedVersion = s.version;
      else if (s.savedVersion === s.version) s.savedVersion = -1;
    }
    return true;
  }

  async bootstrap() {
    if (!this.gistConfigured()) { this.bootstrapped = true; return true; }
    try {
      await this.mergeFromGist();
      this.bootstrapped = true;
      this.gist.lastError = null;
      this.log('LogStore: gist bootstrap OK — ' + this.sessions.size + ' session(s) known, next id ' + this.prefix + this.nextNum);
      this._scheduleFlush(500);
      return true;
    } catch (e) {
      this.gist.lastError = 'bootstrap: ' + e.message;
      this.log('LogStore: gist bootstrap failed (will retry):', e.message);
      setTimeout(() => this.bootstrap(), 15000).unref();
      return false;
    }
  }

  pending() { let n = 0; for (const s of this.sessions.values()) if (s.version !== s.savedVersion) n++; return n; }

  _scheduleFlush(delay) {
    if (!this.gistConfigured()) return;
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, delay != null ? delay : this.flushDelayMs);
    if (this._timer.unref) this._timer.unref();
  }

  async flush() {
    if (!this.gistConfigured() || !this.bootstrapped) { if (this.gistConfigured()) this._scheduleFlush(5000); return false; }
    if (this.gist.saving) { this._scheduleFlush(1000); return false; }
    if (![...this.sessions.values()].some(s => s.version !== s.savedVersion)) return true;
    this.gist.saving = true;
    try {
      await this.mergeFromGist();                 // never write blind: fold in anything another instance saved
    } catch (e) {
      this.gist.failures++; this.gist.lastError = e.message; this.gist.saving = false;
      this.log('LogStore: gist read failed (' + this.gist.failures + '), will retry:', e.message);
      this._scheduleFlush(Math.min(30000, 2000 * Math.pow(2, this.gist.failures)));
      return false;
    }
    const dirty = [...this.sessions.values()].filter(s => s.version !== s.savedVersion);
    if (!dirty.length) { this.gist.saving = false; return true; }
    const snap = new Map(dirty.map(s => [s.id, s.version]));
    const files = {};
    for (const s of dirty) {
      files[s.id + '.jsonl'] = { content: this.rawJsonl(s.id) || '\n' };
      if (s.events.p1.size) files[s.id + '_puzzle1_events.csv'] = { content: this.eventsCsv([s.id], 'p1') };
      if (s.events.p2.size) files[s.id + '_puzzle2_events.csv'] = { content: this.eventsCsv([s.id], 'p2') };
    }
    files['sessions.csv'] = { content: this.summaryCsv('all') };
    try {
      await this._api('PATCH', '/gists/' + this.gistId, { files });
      for (const s of dirty) s.savedVersion = Math.max(s.savedVersion, snap.get(s.id));
      this.gist.lastSaved = new Date().toISOString(); this.gist.lastError = null; this.gist.failures = 0;
    } catch (e) {
      this.gist.failures++; this.gist.lastError = e.message;
      this.log('LogStore: gist save failed (' + this.gist.failures + '), will retry:', e.message);
    } finally {
      this.gist.saving = false;
      if (this.pending()) this._scheduleFlush(Math.min(30000, 2000 * Math.pow(2, this.gist.failures)));
    }
    return this.pending() === 0;
  }

  status() {
    return { logging_enabled: this.enabled, gist: Object.assign({ pending_sessions: this.pending(), bootstrapped: this.bootstrapped }, this.gist),
             sessions: this.listSessions() };
  }
}

function cmpSession(a, b) {
  const na = parseInt(a.replace(/\D/g, ''), 10), nb = parseInt(b.replace(/\D/g, ''), 10);
  return (isNaN(na) || isNaN(nb) || na === nb) ? (a < b ? -1 : a > b ? 1 : 0) : na - nb;
}

module.exports = { LogStore, P1_COLS, P2_COLS, ALL_COLS, SUMMARY_COLS };
