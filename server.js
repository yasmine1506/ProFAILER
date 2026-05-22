const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// Find the HTML file — works whether index.html is in public/ or alongside server.js
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : __dirname;

const INDEX = path.join(PUBLIC_DIR, 'index.html');

// Verify index.html exists at startup so the error is obvious
if (!fs.existsSync(INDEX)) {
  console.error(`ERROR: Cannot find index.html`);
  console.error(`Looked in: ${INDEX}`);
  process.exit(1);
}
console.log(`Serving HTML from: ${INDEX}`);

// ── GitHub Gist analytics ──────────────────────────────────────────────────
// Set GIST_ID and GITHUB_TOKEN as environment variables in Render.
// GIST_ID: the ID of a private Gist containing a file called sessions.csv
// GITHUB_TOKEN: a personal access token with the 'gist' scope
//
// The CSV will have one row per session (all puzzles), with puzzle-specific
// columns nested as JSON strings for easy import into Excel/SPSS.
// If the env vars are not set, analytics is silently skipped.

const GIST_ID = process.env.GIST_ID || null;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;
const ANALYTICS_ENABLED = !!(GIST_ID && GITHUB_TOKEN);

if (ANALYTICS_ENABLED) {
  console.log(`Analytics: Gist logging enabled (gist ${GIST_ID})`);
} else {
  console.log('Analytics: GIST_ID / GITHUB_TOKEN not set — logging disabled');
}

// CSV column headers — one row per session
const CSV_HEADERS = [
  'session_id',
  'session_start',
  'session_end',
  'session_duration_sec',
  'puzzles_included',
  'logging_enabled',
  // Puzzle 1
  'p1_included',
  'p1_start',
  'p1_end',
  'p1_duration_sec',
  'p1_completed',
  'p1_force_advanced',
  'p1_training_attempts',
  'p1_submit_attempts',
  'p1_phase2_complete',
  'p1_training_log',
  'p1_scan_log',
  'p1_p1_tags',
  'p1_p2_tags',
  'p1_justifications',
  // Puzzle 2
  'p2_included',
  'p2_start',
  'p2_end',
  'p2_duration_sec',
  'p2_completed',
  'p2_force_advanced',
  'p2_phase1_tx0_attempts',
  'p2_phase1_tx1_attempts',
  'p2_phase1_tx0_log',
  'p2_phase1_tx1_log',
  'p2_verdict_tx0',
  'p2_verdict_tx1',
  'p2_phase2_tx0_attempts',
  'p2_phase2_tx1_attempts',
  'p2_phase2_tx0_log',
  'p2_phase2_tx1_log',
  'p2_result',
  'p2_both_verified',
  // Puzzle 3
  'p3_included',
  'p3_start',
  'p3_end',
  'p3_duration_sec',
  'p3_completed',
  'p3_force_advanced',
  'p3_generation_attempts',
  'p3_hints_triggered',
  'p3_phase1_log',
  'p3_phase2_attempts',
  'p3_phase2_results',
];

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = typeof val === 'object' ? JSON.stringify(val) : String(val);
  // Escape quotes and wrap in quotes if contains comma, newline, or quote
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function isoTs(ms) {
  if (!ms) return '';
  return new Date(ms).toISOString();
}

function durSec(startMs, endMs) {
  if (!startMs || !endMs) return '';
  return Math.round((endMs - startMs) / 1000);
}

// Build one CSV row object from the session analytics record
function buildRow(rec) {
  const p1s = rec.puzzleData[1] || {};
  const p2s = rec.puzzleData[2] || {};
  const p3s = rec.puzzleData[3] || {};

  // Helper: pull justifications out of p1 puzzle state
  // p1s.justifications is {roundN: {p1: text, p2: text}} — compiled at capture time
  function p1inc() { return rec.puzzlesIncluded.includes(1); }
  function p2inc() { return rec.puzzlesIncluded.includes(2); }
  function p3inc() { return rec.puzzlesIncluded.includes(3); }

  return [
    rec.sessionId,
    isoTs(rec.sessionStart),
    isoTs(rec.sessionEnd),
    durSec(rec.sessionStart, rec.sessionEnd),
    rec.puzzlesIncluded.join(';'),
    rec.loggingEnabled ? '1' : '0',

    // Puzzle 1
    p1inc() ? '1' : '0',
    isoTs(p1s.startTime),
    isoTs(p1s.endTime),
    durSec(p1s.startTime, p1s.endTime),
    p1s.completed ? '1' : '0',
    p1s.forceAdvanced ? '1' : '0',
    p1s.trainingRound ?? '',
    p1s.p2SubmitAttempts ?? '',
    p1s.phase2Complete ? '1' : '0',
    JSON.stringify(p1s.trainingLog || []),
    JSON.stringify(p1s.scanLog || []),
    JSON.stringify(p1s.p1Tags || {}),
    JSON.stringify(p1s.p2Tags || {}),
    JSON.stringify(p1s.justifications || {}),

    // Puzzle 2
    p2inc() ? '1' : '0',
    isoTs(p2s.startTime),
    isoTs(p2s.endTime),
    durSec(p2s.startTime, p2s.endTime),
    p2s.completed ? '1' : '0',
    p2s.forceAdvanced ? '1' : '0',
    (p2s.p1logs && p2s.p1logs[0]) ? p2s.p1logs[0].length : '',
    (p2s.p1logs && p2s.p1logs[1]) ? p2s.p1logs[1].length : '',
    JSON.stringify((p2s.p1logs && p2s.p1logs[0]) || []),
    JSON.stringify((p2s.p1logs && p2s.p1logs[1]) || []),
    (p2s.finalVerdicts && p2s.finalVerdicts[0]) || '',
    (p2s.finalVerdicts && p2s.finalVerdicts[1]) || '',
    (p2s.p2logs && p2s.p2logs[0]) ? p2s.p2logs[0].length : '',
    (p2s.p2logs && p2s.p2logs[1]) ? p2s.p2logs[1].length : '',
    JSON.stringify((p2s.p2logs && p2s.p2logs[0]) || []),
    JSON.stringify((p2s.p2logs && p2s.p2logs[1]) || []),
    p2s.p2result || '',
    (p2s.finalVerdicts && p2s.finalVerdicts[0] === 'verified' && p2s.finalVerdicts[1] === 'verified') ? '1' : '0',

    // Puzzle 3
    p3inc() ? '1' : '0',
    isoTs(p3s.startTime),
    isoTs(p3s.endTime),
    durSec(p3s.startTime, p3s.endTime),
    p3s.completed ? '1' : '0',
    p3s.forceAdvanced ? '1' : '0',
    (p3s.g && p3s.g.count) || 0,
    p3s.hintsTriggered ?? '',
    JSON.stringify(p3s.p1History || []),
    p3s.p2AttemptCount ?? '',
    JSON.stringify(p3s.p2Attempts || []),
  ].map(csvEscape).join(',');
}

// Fetch current CSV from Gist, append row, push back
async function appendToGist(row) {
  if (!ANALYTICS_ENABLED) return;

  return new Promise((resolve, reject) => {
    // 1. GET current gist
    const getOpts = {
      hostname: 'api.github.com',
      path: `/gists/${GIST_ID}`,
      method: 'GET',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'DEER-Analytics/1.0',
        'Accept': 'application/vnd.github.v3+json',
      }
    };

    const getReq = https.request(getOpts, (getRes) => {
      let body = '';
      getRes.on('data', d => body += d);
      getRes.on('end', () => {
        let gist;
        try { gist = JSON.parse(body); } catch (e) {
          console.error('Analytics: Failed to parse Gist response', e.message);
          return reject(e);
        }

        const file = gist.files && gist.files['sessions.csv'];
        let currentContent = file ? (file.content || '') : '';

        // Add header row if file is empty or missing
        if (!currentContent.trim()) {
          currentContent = CSV_HEADERS.join(',') + '\n';
        }

        const newContent = currentContent.trimEnd() + '\n' + row + '\n';

        // 2. PATCH gist with new content
        const payload = JSON.stringify({
          files: { 'sessions.csv': { content: newContent } }
        });

        const patchOpts = {
          hostname: 'api.github.com',
          path: `/gists/${GIST_ID}`,
          method: 'PATCH',
          headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'User-Agent': 'DEER-Analytics/1.0',
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          }
        };

        const patchReq = https.request(patchOpts, (patchRes) => {
          let pb = '';
          patchRes.on('data', d => pb += d);
          patchRes.on('end', () => {
            if (patchRes.statusCode === 200) {
              console.log('Analytics: Session row written to Gist successfully');
              resolve();
            } else {
              console.error(`Analytics: Gist PATCH returned ${patchRes.statusCode}:`, pb.slice(0, 200));
              reject(new Error(`Gist PATCH ${patchRes.statusCode}`));
            }
          });
        });
        patchReq.on('error', reject);
        patchReq.write(payload);
        patchReq.end();
      });
    });
    getReq.on('error', reject);
    getReq.end();
  });
}

// ── Session analytics accumulator ─────────────────────────────────────────
// Tracks timing, logging toggle state, and puzzle snapshots for one session.
// Only committed to the Gist at session end (all puzzles complete or reset).

let session = null; // null when no session is active

function newSession(puzzles) {
  session = {
    sessionId: 'S' + Date.now(),
    sessionStart: Date.now(),
    sessionEnd: null,
    puzzlesIncluded: [...puzzles],
    loggingEnabled: false,   // set via analytics-toggle message from room.html admin
    puzzleData: {},          // {puzzleNum: {startTime, endTime, forceAdvanced, ...state}}
    _currentPuzzle: null,
    _puzzleStartTime: null,
  };
  console.log(`Analytics: New session ${session.sessionId} — puzzles [${puzzles}]`);
}

function sessionStartPuzzle(puzzleNum, startTime) {
  if (!session) return;
  session._currentPuzzle = puzzleNum;
  session._puzzleStartTime = startTime || Date.now();
  if (!session.puzzleData[puzzleNum]) {
    session.puzzleData[puzzleNum] = { startTime: session._puzzleStartTime };
  }
}

function sessionEndPuzzle(puzzleNum, puzzleState, forceAdvanced) {
  if (!session) return;
  const endTime = Date.now();
  const pd = session.puzzleData[puzzleNum] || {};
  pd.endTime = endTime;
  pd.forceAdvanced = !!forceAdvanced;

  if (puzzleNum === 1 && puzzleState) {
    pd.completed = puzzleState.phase2Complete === true;
    pd.trainingRound = puzzleState.trainingRound;
    pd.p2SubmitAttempts = puzzleState.p2SubmitAttempts;
    pd.phase2Complete = puzzleState.phase2Complete;
    pd.trainingLog = puzzleState.trainingLog || [];
    pd.scanLog = puzzleState.scanLog || [];
    pd.p1Tags = puzzleState.p1Tags || {};
    pd.p2Tags = puzzleState.p2Tags || {};
    // justifications sent separately via analytics-p1-justifications message
    pd.justifications = pd.justifications || {};
  }

  if (puzzleNum === 2 && puzzleState) {
    pd.completed = puzzleState.p2result === 'win';
    pd.p1logs = puzzleState.p1logs || [[], []];
    pd.finalVerdicts = puzzleState.finalVerdicts || [null, null];
    pd.p2logs = puzzleState.p2logs || [[], []];
    pd.p2result = puzzleState.p2result || '';
  }

  if (puzzleNum === 3 && puzzleState) {
    pd.completed = puzzleState.puzzle3Complete === true;
    pd.g = puzzleState.g || {};
    pd.hintsTriggered = [puzzleState.g && puzzleState.g.hint1,
                         puzzleState.g && puzzleState.g.hint2,
                         puzzleState.g && puzzleState.g.hint3].filter(Boolean).length;
    pd.p1History = puzzleState.p1History || [];
    pd.p2AttemptCount = puzzleState.p2Attempts ? puzzleState.p2Attempts.length : 0;
    pd.p2Attempts = puzzleState.p2Attempts || [];
  }

  session.puzzleData[puzzleNum] = pd;
}

async function commitSession() {
  if (!session) return;
  if (!session.loggingEnabled) {
    console.log('Analytics: Session ended but logging was off — not writing to Gist');
    session = null;
    return;
  }
  session.sessionEnd = Date.now();
  try {
    const row = buildRow(session);
    await appendToGist(row);
  } catch (e) {
    console.error('Analytics: Failed to write session to Gist:', e.message);
  }
  session = null;
}

// ── HTTP server — serves index.html and any static assets ──────────────────
const PUZZLE1 = path.join(PUBLIC_DIR, 'puzzle1.html');

const httpServer = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  // Room shell — served at /room
  if (urlPath === '/room' || urlPath === '/room.html') {
    const roomPath = path.join(PUBLIC_DIR, 'room.html');
    fs.readFile(roomPath, (err, data) => {
      if (err) { res.writeHead(404); res.end('room.html not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // Puzzle 1 — served at /puzzle1 or /puzzle1.html
  if (urlPath === '/puzzle1' || urlPath === '/puzzle1.html' || urlPath.startsWith('/puzzle1#')) {
    fs.readFile(PUZZLE1, (err, data) => {
      if (err) { res.writeHead(404); res.end('puzzle1.html not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // Puzzle 3 — served at /puzzle3 or /puzzle3.html
  const PUZZLE3 = path.join(PUBLIC_DIR, 'puzzle3.html');
  if (urlPath === '/puzzle3' || urlPath === '/puzzle3.html' || urlPath.startsWith('/puzzle3#')) {
    fs.readFile(PUZZLE3, (err, data) => {
      if (err) { res.writeHead(404); res.end('puzzle3.html not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  let filePath = path.join(PUBLIC_DIR, urlPath);
  if (filePath === PUBLIC_DIR || req.url === '/' || req.url.startsWith('/#')) {
    filePath = INDEX;
  }

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.mp4':  'video/mp4',
    '.webm': 'video/webm',
    '.json': 'application/json',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.svg':  'image/svg+xml',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(INDEX, (e2, d2) => {
        if (e2) { res.writeHead(500); res.end('Cannot read index.html'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(d2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ── WebSocket server — real-time state sync ────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

const roomState = {
  p1: null,
  p2: null,
  p3: null,
  room: null,
};

function broadcast(sender, data) {
  wss.clients.forEach(client => {
    if (client !== sender && client.readyState === 1) {
      client.send(data);
    }
  });
}

// Track which puzzles ended by force-advance vs natural win
// key: puzzleNum, value: true = force-advanced
const forceAdvanceFlags = {};

wss.on('connection', (ws, req) => {
  console.log(`Client connected  (total: ${wss.clients.size}) path: ${req.url}`);

  setTimeout(() => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'room', room: roomState }));
    }
  }, 100);

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── Standard state sync ──────────────────────────────────────────
    if (msg.type === 'state') {
      const slot = msg.puzzle || 'p2';
      if (roomState[slot] !== undefined) {
        roomState[slot] = msg.state;
      }
      broadcast(ws, JSON.stringify({ type: 'state', puzzle: slot, state: msg.state }));

      if (slot === 'room') {
        broadcast(ws, JSON.stringify({ type: 'room-state', state: msg.state }));

        // ── Analytics: watch room state transitions ──────────────────
        const R = msg.state;
        if (!R) return;

        // Session start: admin just set phase to intro-video
        if (R.phase === 'intro-video' && R.puzzles && R.puzzles.length > 0) {
          if (!session) {
            newSession(R.puzzles);
            // Apply logging toggle that was set before session started
            if (wss._pendingLoggingEnabled) {
              session.loggingEnabled = true;
              console.log('Analytics: Logging ENABLED for new session (pre-set by admin)');
            }
          }
        }

        // Puzzle start: phase just became 'puzzle'
        if (R.phase === 'puzzle' && R.currentPuzzle && R.puzzleStartTime) {
          if (session && session._currentPuzzle !== R.currentPuzzle) {
            sessionStartPuzzle(R.currentPuzzle, R.puzzleStartTime);
          }
        }
      }
    }

    // ── Analytics: puzzle complete signal ───────────────────────────
    // Sent by room.html for every puzzle end (natural win or force-advance).
    // Commit happens here once all puzzles are done — this is the single
    // reliable point where puzzle state is fully synced to the server.
    if (msg.type === 'puzzle-complete') {
      const puzzleNum = msg.puzzle;
      const isForced = msg.forced || false;
      if (session) {
        sessionEndPuzzle(puzzleNum, roomState['p' + puzzleNum], isForced);
        console.log(`Analytics: Puzzle ${puzzleNum} ended (forced=${isForced}) — data captured`);

        // Commit once every puzzle in the session has an end time
        const allDone = session.puzzlesIncluded.every(
          n => session.puzzleData[n] && session.puzzleData[n].endTime
        );
        if (allDone) {
          console.log('Analytics: All puzzles complete — committing session to Gist');
          commitSession();
        }
      }
    }

    // ── Analytics: justification text from Puzzle 1 ─────────────────
    // Sent by puzzle1.html at the moment of final phase 2 submission
    if (msg.type === 'analytics-p1-justifications') {
      if (session && session.puzzleData[1]) {
        session.puzzleData[1].justifications = msg.justifications || {};
        console.log('Analytics: Puzzle 1 justifications received');
      }
    }

    // ── Analytics: admin logging toggle ─────────────────────────────
    if (msg.type === 'analytics-toggle') {
      wss._pendingLoggingEnabled = !!msg.enabled;
      if (session) {
        session.loggingEnabled = !!msg.enabled;
      }
      console.log(`Analytics: Logging toggle set to ${msg.enabled ? 'ENABLED' : 'DISABLED'}`);
    }

    // ── Reset ────────────────────────────────────────────────────────
    if (msg.type === 'reset-all') {
      // If a session was in progress, discard it (not a completed session)
      if (session) {
        console.log('Analytics: Session reset — discarding in-progress session data');
        session = null;
      }
      Object.keys(forceAdvanceFlags).forEach(k => delete forceAdvanceFlags[k]);
      roomState.p1 = null;
      roomState.p2 = null;
      roomState.p3 = null;
      roomState.room = null;
      console.log('Session reset by admin — all puzzle states cleared');
      const cleared = JSON.stringify({ type: 'room', room: roomState });
      wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(cleared);
      });
    }

    if (msg.type === 'hello') {
      const slot = msg.puzzle || 'p2';
      ws.send(JSON.stringify({ type: 'room', room: roomState }));
      if (slot !== 'room' && roomState[slot]) {
        ws.send(JSON.stringify({ type: 'state', puzzle: slot, state: roomState[slot] }));
      }
      // Send analytics config to admin screen on reconnect
      ws.send(JSON.stringify({
        type: 'analytics-config',
        enabled: ANALYTICS_ENABLED,
        pendingLogging: wss._pendingLoggingEnabled || false
      }));
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected (total: ${wss.clients.size})`);
    if (wss.clients.size === 0) {
      roomState.p1 = null;
      roomState.p2 = null;
      roomState.p3 = null;
      roomState.room = null;
      console.log('All clients disconnected — room state cleared for next session');
    }
  });

  ws.on('error', err => console.error('WebSocket error:', err.message));
});

httpServer.listen(PORT, () => {
  console.log(`DEER server running → http://localhost:${PORT}`);
  console.log('Views:');
  console.log(`  Admin   → http://localhost:${PORT}/room#admin`);
  console.log(`  Screen 2 → http://localhost:${PORT}/room#screen2`);
  console.log(`  Screen 3 → http://localhost:${PORT}/room#screen3`);
});
