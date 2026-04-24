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

// One shared game state per server instance.
// Clients send their full state on every mutation;
// the server fans it out to all other connected clients.
let latestState = null;

function broadcast(sender, data) {
  wss.clients.forEach(client => {
    if (client !== sender && client.readyState === 1 /* OPEN */) {
      client.send(data);
    }
  });
}

wss.on('connection', ws => {
  console.log(`Client connected  (total: ${wss.clients.size})`);

  // Send the current state to a newly connected client so it catches up
  if (latestState) {
    ws.send(JSON.stringify({ type: 'state', state: latestState }));
  }

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'state') {
      latestState = msg.state;
      // Fan out to everyone else
      broadcast(ws, JSON.stringify({ type: 'state', state: latestState }));
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected (total: ${wss.clients.size})`);
    // Clear saved state when everyone leaves so the next session starts fresh
    if (wss.clients.size === 0) {
      latestState = null;
      console.log('All clients disconnected — state cleared for next session');
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
