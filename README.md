# The Xenolinguist's Dilemma — DEER Prototype (Puzzle 2)

A collaborative 2-player digital escape room puzzle for teaching LLM hallucination concepts. Built for remote multiplayer testing across different networks.

---

## Files

```
/
  server.js          — Node.js WebSocket + HTTP server
  package.json       — dependencies (only: ws)
  /public
    index.html       — the full game (standalone or networked)
```

---

## Local testing (single machine, no server needed)

Just open `public/index.html` directly in a browser. The game runs fully offline. Use the Player 1 / Player 2 tabs to switch between views. The header will show "LOCAL MODE".

---

## Multiplayer testing (two laptops, any network)

### Step 1 — Push to GitHub

1. Create a new repository on [github.com](https://github.com) (name it anything, e.g. `xenolinguist-room`)
2. In your terminal:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/xenolinguist-room.git
git branch -M main
git push -u origin main
```

### Step 2 — Deploy to Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your `xenolinguist-room` repository
4. Railway auto-detects Node.js and runs `npm start`
5. Click **Settings → Networking → Generate Domain** to get your public URL
   - It will look like: `https://xenolinguist-room-production.up.railway.app`

Railway deploys automatically on every `git push`. Free tier is generous enough for research sessions.

### Step 3 — Run a playthrough

Open these URLs on the appropriate screens:

| Screen | URL |
|--------|-----|
| Shared / Facilitator | `https://your-app.railway.app/#shared` |
| Player 1 laptop | `https://your-app.railway.app/#p1` |
| Player 2 laptop | `https://your-app.railway.app/#p2` |

Replace `your-app.railway.app` with your actual Railway domain.

Each screen locks to its view — no tab bar, no accidental switching. State syncs in real time across all screens. If a connection drops, it reconnects automatically.

---

## Making changes to the game

1. Edit `public/index.html` locally
2. Test it by opening the file directly in a browser (LOCAL MODE)
3. When ready: `git add . && git commit -m "update" && git push`
4. Railway redeploys in ~30 seconds — no other steps needed

---

## How the sync works

- Every player action (selecting a symbol, logging a sequence, transmitting) sends the full game state to the server via WebSocket
- The server broadcasts it to all other connected clients
- Each client re-renders immediately on receipt
- Modal state (Dr. Searle's notes, confirm dialogs, log viewer) is **local-only** — each screen manages its own modals independently, since they're player-specific

---

## Adding this puzzle to a full room later

When puzzles 1 and 3 are ready, this file slots in as a module. The server architecture stays identical — the state object just grows to include room-level state (current puzzle, solved puzzles, video playback). No refactoring of the game logic is needed.
