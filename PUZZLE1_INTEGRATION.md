# Adding Puzzle 1 to the Room

## What you have now

```
your-repo/
  server.js           ← updated (handles multi-puzzle state)
  package.json
  index.html          ← puzzle 2 (Xenolinguist), updated to tag its messages as puzzle:'p2'
  README.md
  .gitignore
```

## Step 1 — Add puzzle1.html to your repo

Copy `puzzle1.html` into your repo alongside `index.html`:

```
your-repo/
  server.js
  package.json
  index.html          ← puzzle 2
  puzzle1.html        ← puzzle 1 (add this)
  README.md
  .gitignore
```

## Step 2 — Make puzzle 1 tag its WebSocket messages

Puzzle 1 already has `syncState()` and `connectWS()`. You need to add `puzzle:'p1'`
to the message it sends, so the server stores it in the right slot.

Open `puzzle1.html` and find the `syncState` function (around line 682):

```javascript
// BEFORE
function syncState() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({type:'state', state: syncableState()}));
  }
}
```

Change it to:

```javascript
// AFTER
function syncState() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({type:'state', puzzle:'p1', state: syncableState()}));
  }
}
```

Also find the `ws.onmessage` handler (around line 667) and update it to filter
for puzzle 1 messages only:

```javascript
// BEFORE
ws.onmessage = (e) => {
  try {
    const msg = JSON.parse(e.data);
    if (msg.type === 'state') applyRemoteState(msg.state);
  } catch(ex) {}
};

// AFTER
ws.onmessage = (e) => {
  try {
    const msg = JSON.parse(e.data);
    // Handle direct state updates for puzzle 1
    if (msg.type === 'state' && (!msg.puzzle || msg.puzzle === 'p1')) {
      applyRemoteState(msg.state);
    }
    // Handle full room state on first connect
    if (msg.type === 'room' && msg.room && msg.room.p1) {
      applyRemoteState(msg.room.p1);
    }
  } catch(ex) {}
};
```

Also find the `hello` message sent in `connectWS` (around line 664) and tag it:

```javascript
// BEFORE
ws.send(JSON.stringify({type:'hello'}));

// AFTER
ws.send(JSON.stringify({type:'hello', puzzle:'p1'}));
```

## Step 3 — Update the server to serve puzzle1.html

The server currently serves only `index.html` for all routes. Update it to also
serve `puzzle1.html` at `/puzzle1` or any path ending in `puzzle1.html`.

Open `server.js` and find the HTTP handler. The fallback currently sends `index.html`
for unknown paths. Add a check before the fallback:

```javascript
// In the httpServer createServer callback, BEFORE the final fallback:
if (req.url.startsWith('/puzzle1')) {
  const p1Path = path.join(PUBLIC_DIR, 'puzzle1.html');
  fs.readFile(p1Path, (err, data) => {
    if (err) { res.writeHead(404); res.end('puzzle1.html not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
  return;
}
```

## Step 4 — Push to GitHub

```bash
git add server.js index.html puzzle1.html
git commit -m "add puzzle 1, multi-puzzle server"
git push
```

Render/Railway redeploys automatically.

## Step 5 — Player URLs

Each puzzle is accessed at a different path + hash:

| Screen        | Puzzle 1 URL                          | Puzzle 2 URL                     |
|---------------|---------------------------------------|----------------------------------|
| Player 1      | `your-app.com/puzzle1#p1`             | `your-app.com/#p1`               |
| Player 2      | `your-app.com/puzzle1#p2`             | `your-app.com/#p2`               |
| Shared screen | `your-app.com/puzzle1#shared`         | `your-app.com/#shared`           |

Players play puzzle 1 first, then you give them the puzzle 2 URLs when ready.

## Step 6 — Resetting between sessions

To reset puzzle 1: `your-app.com/puzzle1?reset#p1` (any player opens this)
To reset puzzle 2: `your-app.com/?reset#shared`

When all browser windows close, both puzzles reset automatically.

---

## How the server handles both puzzles

The updated `server.js` stores state in separate slots:

```javascript
const roomState = {
  p1: null,   // puzzle 1 state
  p2: null,   // puzzle 2 (Xenolinguist) state
  p3: null,   // puzzle 3 (future)
};
```

Each puzzle tags its WebSocket messages with `puzzle:'p1'` or `puzzle:'p2'`.
The server routes messages to the correct slot and fans them out only to clients
playing the same puzzle. Players on different puzzles don't interfere with each other.
