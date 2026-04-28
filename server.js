const http = require('http');
const fs = require('fs');
const path = require('path');
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
  console.error(`Make sure index.html is either:`);
  console.error(`  - In a "public" folder next to server.js, OR`);
  console.error(`  - In the same folder as server.js`);
  process.exit(1);
}
console.log(`Serving HTML from: ${INDEX}`);

// ── HTTP server — serves index.html and any static assets ──────────────────
const httpServer = http.createServer((req, res) => {
  let filePath = path.join(PUBLIC_DIR, req.url.split('?')[0]);
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
  p3: null,   // puzzle 3 state (future)
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

  // Send the client the current room state so it catches up
  ws.send(JSON.stringify({ type: 'room', room: roomState }));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'state') {
      const slot = msg.puzzle || 'p2'; // default to p2 for backwards compat
      if (roomState[slot] !== undefined) {
        roomState[slot] = msg.state;
      }
      // Fan out to all other clients
      broadcast(ws, JSON.stringify({ type: 'state', puzzle: slot, state: msg.state }));
    }

    if (msg.type === 'hello') {
      // Puzzle 1 sends 'hello' on connect — respond with current state for its slot
      const slot = msg.puzzle || 'p1';
      if (roomState[slot]) {
        ws.send(JSON.stringify({ type: 'state', puzzle: slot, state: roomState[slot] }));
      }
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected (total: ${wss.clients.size})`);
    if (wss.clients.size === 0) {
      roomState.p1 = null;
      roomState.p2 = null;
      roomState.p3 = null;
      console.log('All clients disconnected — room state cleared for next session');
    }
  });

  ws.on('error', err => console.error('WebSocket error:', err.message));
});

httpServer.listen(PORT, () => {
  console.log(`Xenolinguist server running → http://localhost:${PORT}`);
  console.log('Views:');
  console.log(`  Shared  → http://localhost:${PORT}/#shared`);
  console.log(`  Player 1 → http://localhost:${PORT}/#p1`);
  console.log(`  Player 2 → http://localhost:${PORT}/#p2`);
});
