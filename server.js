const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

// ── HTTP server — serves index.html and any static assets ──────────────────
const httpServer = http.createServer((req, res) => {
  // Normalise URL: strip query string, default to index.html
  let filePath = path.join(PUBLIC, req.url.split('?')[0]);
  if (filePath === PUBLIC || filePath === path.join(PUBLIC, '/')) {
    filePath = path.join(PUBLIC, 'index.html');
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
      if (err.code === 'ENOENT') {
        // Fall back to index.html for any unknown path (single-page app)
        fs.readFile(path.join(PUBLIC, 'index.html'), (e2, d2) => {
          if (e2) { res.writeHead(500); res.end('Server error'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(d2);
        });
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
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
