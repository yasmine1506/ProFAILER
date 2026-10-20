const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { LogStore } = require('./logstore');

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
  console.error(`Make sure index.html is either:`);
  console.error(`  - In a "public" folder next to server.js, OR`);
  console.error(`  - In the same folder as server.js`);
  process.exit(1);
}
console.log(`Serving HTML from: ${INDEX}`);

// ── HTTP server — serves index.html and any static assets ──────────────────
const PUZZLE1 = path.join(PUBLIC_DIR, 'puzzle1.html');

// ── Research log store (disk + private gist). See logstore.js and OPERATIONS.md ──
const logStore = new LogStore({
  dataDir:   process.env.DATA_DIR || path.join(__dirname, 'data'),
  gistId:    process.env.GIST_ID,
  gistToken: process.env.GIST_TOKEN,
  apiBase:   process.env.GIST_API_BASE,
  prefix:    process.env.SESSION_PREFIX || 'S',
  flushDelayMs: parseInt(process.env.GIST_FLUSH_MS || '5000', 10),
});
if (!logStore.gistConfigured()) console.warn('WARNING: GIST_ID / GIST_TOKEN not set — logs are kept on this server only (lost on redeploy). See OPERATIONS.md.');
logStore.bootstrap();
const ADMIN_KEY = process.env.ADMIN_KEY || '';
if (!ADMIN_KEY) console.warn('WARNING: ADMIN_KEY not set — the log download endpoints are disabled.');

function adminAuthorized(req, url) {
  if (!ADMIN_KEY) return false;
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('key') || '';
  const a = Buffer.from(given), b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function handleAdminApi(req, res, url) {
  const send = (code, type, body, extra) => { res.writeHead(code, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store' }, extra || {})); res.end(body); };
  if (!ADMIN_KEY) return send(503, 'text/plain', 'ADMIN_KEY is not set on the server.');
  if (!adminAuthorized(req, url)) return send(401, 'text/plain', 'Wrong or missing admin key.');
  if (url.pathname === '/admin/status') return send(200, 'application/json', JSON.stringify(logStore.status()));
  if (url.pathname === '/admin/save-now') {
    logStore.flush().then(ok => send(200, 'application/json', JSON.stringify({ ok, status: logStore.status() })));
    return;
  }
  if (url.pathname === '/admin/export') {
    const type = url.searchParams.get('type') || 'events';
    const session = url.searchParams.get('session') || 'all';
    const puzzle = url.searchParams.get('puzzle') || 'all';
    const ids = session === 'all' ? 'all' : session.split(',');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = (type === 'summary' ? 'sessions_summary' : 'events' + (puzzle !== 'all' ? '_puzzle' + puzzle.slice(1) : '')) + '_' + (session === 'all' ? 'all' : session.replace(/,/g, '+')) + '_' + stamp + '.csv';
    const csv = type === 'summary' ? logStore.summaryCsv(ids) : logStore.eventsCsv(ids, puzzle);
    return send(200, 'text/csv; charset=utf-8', '\ufeff' + csv, { 'Content-Disposition': 'attachment; filename="' + name + '"' });
  }
  return send(404, 'text/plain', 'Unknown admin endpoint');
}

const httpServer = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (urlPath.startsWith('/admin/')) {
    return handleAdminApi(req, res, new URL(req.url, 'http://localhost'));
  }

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
  if (urlPath === '/puzzle1' || urlPath === '/puzzle1.html') {
    fs.readFile(PUZZLE1, (err, data) => {
      if (err) { res.writeHead(404); res.end('puzzle1.html not found — make sure it is in the same folder as server.js'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  let filePath = path.join(PUBLIC_DIR, urlPath);
  if (filePath === PUBLIC_DIR || urlPath === '/') {
    filePath = INDEX;
  }

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.json': 'application/json',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.svg':  'image/svg+xml',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Any unknown path → serve index.html (hash routing handled client-side)
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

// Room state holds each puzzle's state separately.
// Clients send { type:'state', puzzle:'p1'|'p2', state:{...} }
// Server fans out to all other clients for that puzzle slot.
// Backwards-compatible: if no puzzle field, treat as puzzle 'p2' (legacy).
const roomState = {
  p1: null,   // puzzle 1 state
  p2: null,   // puzzle 2 state (xenolinguist)
  room: null, // room shell state
};

function broadcast(sender, data) {
  wss.clients.forEach(client => {
    if (client !== sender && client.readyState === 1 /* OPEN */) {
      client.send(data);
    }
  });
}

wss.on('connection', (ws, req) => {
  console.log(`Client connected  (total: ${wss.clients.size}) path: ${req.url}`);

  // Delay the initial state send slightly so the client has time to wire up
  // its onmessage handler before the message arrives (avoids a race condition
  // where the message is delivered in the same tick as the connection open)
  setTimeout(() => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'room', room: roomState }));
    }
  }, 100);

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'state') {
      const slot = msg.puzzle || 'p2';
      if (roomState[slot] !== undefined) {
        roomState[slot] = msg.state;
      }
      // Broadcast to all other clients — include puzzle tag so each client filters
      broadcast(ws, JSON.stringify({ type: 'state', puzzle: slot, state: msg.state }));

      // If room state changed, also broadcast a dedicated room-state message
      if (slot === 'room') {
        broadcast(ws, JSON.stringify({ type: 'room-state', state: msg.state }));
      }
    }

    // ── research log: browsers send rows, we acknowledge only after they are stored ──
    if (msg.type === 'log') {
      const acked = logStore.addEvents(msg.puzzle, Array.isArray(msg.events) ? msg.events.slice(0, 500) : []);
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'log-ack', ids: acked }));
      return;
    }
    if (msg.type === 'session-start') {
      logStore.startSession(msg.puzzles).then(id => {
        console.log('Session started: ' + id);
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'session-id', id, reqId: msg.reqId }));
      });
      return;
    }
    if (msg.type === 'room-event') {
      const sid = typeof msg.session === 'string' && msg.session ? msg.session : (roomState.room && roomState.room.sessionId);
      if (sid && msg.event) {
        logStore.addRoomEvent(sid, { event: msg.event, puzzle: msg.puzzle, how: msg.how, role: msg.role, puzzles: msg.puzzles });
        if (msg.event === 'session_complete' || msg.event === 'puzzle_end') logStore.flush();
      }
      return;
    }

    if (msg.type === 'reset-all') {
      const sid = roomState.room && roomState.room.sessionId;
      if (sid) logStore.addRoomEvent(sid, { event: 'session_reset' });
      logStore.flush();       // push everything to the gist BEFORE clearing anything
      roomState.p1 = null;
      roomState.p2 = null;
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
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected (total: ${wss.clients.size})`);
    if (wss.clients.size === 0) {
      logStore.flush();
      roomState.p1 = null;
      roomState.p2 = null;
      roomState.room = null;
      console.log('All clients disconnected — room state cleared for next session');
    }
  });

  ws.on('error', err => console.error('WebSocket error:', err.message));
});

// Save everything to the gist when Render stops / redeploys this server (it sends SIGTERM first)
let shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    if (shuttingDown) return; shuttingDown = true;
    console.log(sig + ' — flushing logs before exit');
    try { await Promise.race([logStore.flush(), new Promise(r => setTimeout(r, 8000))]); } catch (e) {}
    process.exit(0);
  });
}

httpServer.listen(PORT, () => {
  console.log(`Xenolinguist server running → http://localhost:${PORT}`);
  console.log('Views:');
  console.log(`  Shared  → http://localhost:${PORT}/#shared`);
  console.log(`  Player 1 → http://localhost:${PORT}/#p1`);
  console.log(`  Player 2 → http://localhost:${PORT}/#p2`);
});
