# DEER — Digital Educational Escape Room
## Operations Guide

---

## Overview

This is a 3-puzzle networked escape room for research playtesting. Two players collaborate on each puzzle from separate laptops. A facilitator controls the session flow from a third screen.

**The three puzzles:**
| # | Name | Learning objective |
|---|------|-------------------|
| 1 | Puzzle 1 | Image classifier bias and AI fairness |
| 2 | The Xenolinguist's Dilemma | LLM hallucinations and token prediction |
| 3 | PARTS Puzzle | AI prompt engineering (Persona, Aim, Recipient, Tone, Structure) |

---

## Repository structure

```
your-repo/
  server.js              ← Node.js server (WebSocket + HTTP)
  package.json           ← dependencies (only: ws)
  .gitignore
  public/
    room.html            ← room shell (session control, videos, role selection)
    index.html           ← Puzzle 2: The Xenolinguist's Dilemma
    puzzle1.html         ← Puzzle 1
    puzzle3.html         ← Puzzle 3: PARTS Puzzle
    videos/
      intro.mp4          ← Main intro video (always plays first)
      puzzle1-intro.mp4  ← Puzzle 1 intro video
      puzzle2-intro.mp4  ← Puzzle 2 intro video
      puzzle3-intro.mp4  ← Puzzle 3 intro video
```

> **Important:** Video files must be named exactly as shown above. Each puzzle intro video plays automatically before that puzzle begins.

---

## First-time setup

### 1. Add files to your GitHub repo

Your repo should contain all the files listed above. If you haven't already:

```bash
git add .
git commit -m "initial setup"
git push
```

### 2. Deploy to Render (free hosting)

1. Go to [render.com](https://render.com) and sign in with GitHub
2. Click **New → Web Service**
3. Connect your repo
4. Set:
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
5. Click **Deploy**
6. Go to **Settings → Custom Domain** — copy your public URL (e.g. `https://your-app.onrender.com`)

> Render's free tier spins down after 15 minutes of inactivity. **Open your URL ~1 minute before players arrive** to wake it up. Once the session is running it stays responsive.

### 3. After any code changes

```bash
git add .
git commit -m "describe your change"
git push
```

Render redeploys automatically in ~30 seconds. No other steps needed.

---

## Running a session

### Before the session

**Open these three URLs — one per screen:**

| Screen | URL | Who |
|--------|-----|-----|
| Facilitator / admin | `https://your-app.com/room#admin` | You |
| Player 1 laptop | `https://your-app.com/room#screen2` | Asset 1 player |
| Player 2 laptop | `https://your-app.com/room#screen3` | Asset 2 player |

All three screens must be open before you start the session.

---

### Step-by-step session flow

**Step 1 — Configure the session (admin screen)**

On the admin screen you will see the Session Setup panel. Toggle which puzzles to include in this session — you can run any combination of puzzles 1, 2, and 3 in any order. The selected puzzles will run in numerical order (1 → 2 → 3 if all selected, or 2 → 3 if only those two are selected, etc.).

Click **▶ Start Session** when ready.

**Step 2 — Intro video**

All three screens show the intro video simultaneously. The video is synced — all screens start at the same point. If the video does not autoplay on a player's screen (browser autoplay restrictions), it will play silently or show a play prompt; this is normal and does not affect the other screens.

The admin screen has a **Skip →** button to advance past the video if needed.

**Step 3 — Role selection (player screens)**

After the intro video, both player screens show the **Agent Identification** screen. Each player clicks to claim their role:
- **Asset 1** → controls the main puzzle mechanics (lattice, story generation, etc.)
- **Asset 2** → reads probabilities, analyses outputs, makes guesses

Each role can only be claimed once. The admin screen shows both roles' status in real time. Once both players have claimed their roles, they both see a confirmation screen.

> Players keep their roles for the entire session — they only select once at the beginning.

**Step 4 — Puzzle intro video**

All three screens show the intro video for the first selected puzzle. The admin screen has a **Skip →** button.

**Step 5 — Puzzle begins**

Players are automatically redirected to their puzzle screen at their correct role URL. The admin screen shows the current session state and puzzle number.

The puzzle runs independently — the admin screen monitors for the win condition in the background. When players complete the puzzle, the next puzzle's intro video plays automatically on all screens.

**Step 6 — Repeat for subsequent puzzles**

The flow repeats: intro video → puzzle → intro video → puzzle, until all selected puzzles are complete.

**Step 7 — Session complete**

All screens show a completion screen when the final puzzle is finished.

---

### Admin controls during a session

The admin screen shows:
- **Current phase** (video / role-select / puzzle / complete)
- **Current puzzle number**
- **Asset 1 and Asset 2 assignment status**
- **Puzzle order** with completed puzzles greyed out

Two control buttons are always available:
- **⏭ Force advance** — manually skips to the next phase (use if a video doesn't end correctly, or if you want to move players on from a puzzle)
- **↺ Reset session** — wipes all state and returns to the setup screen. Use this between playthroughs.

---

## Resetting between playthroughs

**Option A — Admin reset (recommended):**
On the admin screen, click **↺ Reset session**. This resets the room state for all screens. Then reconfigure and start a new session.

**Option B — URL reset:**
Open `https://your-app.com/room#admin?reset` — this forces a fresh state broadcast to all connected screens.

**Note:** State is also cleared automatically when all browser windows close (the server wipes state when the last client disconnects). So closing all tabs and reopening is a clean reset.

---

## Testing individual puzzles (without the room shell)

Each puzzle can be tested standalone without going through the room flow. Open two browser windows or two laptops:

| Puzzle | Player 1 URL | Player 2 URL |
|--------|-------------|-------------|
| Puzzle 1 | `your-app.com/puzzle1#p1` | `your-app.com/puzzle1#p2` |
| Puzzle 2 | `your-app.com/#p1` | `your-app.com/#p2` |
| Puzzle 3 | `your-app.com/puzzle3#p1` | `your-app.com/puzzle3#p2` |

To reset a standalone puzzle mid-session, add `?reset` to any URL:
- `your-app.com/puzzle1?reset#p1`
- `your-app.com/?reset#p1`
- `your-app.com/puzzle3?reset#p1`

---

## Testing locally (no internet required)

All puzzle files work as standalone HTML files — open them directly in a browser from your file system. State does not sync between two local windows (no server), but the full game logic works for solo testing. The header will show **LOCAL MODE**.

For full two-player local testing on the same machine:
```bash
npm install
node server.js
```
Then open `http://localhost:3000/room#admin`, `http://localhost:3000/room#screen2`, `http://localhost:3000/room#screen3` in separate windows.

---

## How state synchronisation works

- Every player action (selecting a symbol, logging a sequence, submitting a guess) immediately sends the full game state to the server via WebSocket
- The server stores the state and broadcasts it to all other connected screens
- Each screen re-renders from the received state within milliseconds
- If a connection drops, the client reconnects automatically every 2 seconds and receives the latest state on reconnect
- **Modal windows** (Dr. Searle's notes, confirm dialogs, log viewer, win/lose popups) are **local-only** — each screen manages these independently. Closing a modal on one screen does not affect the other

---

## Puzzle-specific notes

### Puzzle 2 — The Xenolinguist's Dilemma

- **Asset 1** sees the lattice (selects one symbol per token column)
- **Asset 2** sees the neural network probability view (scores appear on connection lines as Asset 1 selects)
- **Phase 1:** Both players construct output sequences for two transmissions. The shared terminal (left column on each player's screen) shows both transmissions — the active one is highlighted, the inactive one is greyed out. Players must log at least one output for **each transmission** before they can transmit.
- **Phase 2:** Players receive translation clues from "a friend" and must reconstruct the sequences knowing their English meanings. Roles swap between the two transmissions.
- **Win:** Both Phase 2 outputs match the verified truth sequences

**Dr. Searle's Notes** are accessible at any time via the button in the top header bar.

### Puzzle 1

- **Asset 1** labels images with bias verdicts
- **Asset 2** reviews and cross-checks
- **Win:** Both players correctly tag all images in Phase 2

### Puzzle 3 — PARTS Puzzle

- **Asset 1** operates the AI writing assistant (selects Persona, Recipient, Tone — Aim and Structure are locked)
- **Asset 2** reads the generated stories and tries to identify the PARTS settings
- **Phase 1:** Asset 1 generates stories; Asset 2 observes outputs and the PARTS framework
- **Phase 2:** Asset 2 guesses all 5 PARTS settings (3 attempts). Correct settings lock in green.
- **Win:** Asset 2 correctly identifies all settings within 3 attempts

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Player screen shows "Reconnecting..." | The server may be waking up (Render free tier). Wait 30–60 seconds and refresh. |
| Video doesn't play on a player's screen | This is a browser autoplay restriction. It doesn't affect other screens. Use the admin **Skip →** button to advance if needed. |
| Player was redirected to a puzzle but needs to go back | Use the admin **Force advance** button to move to the next phase, then **Reset session** if you need to restart. |
| Win condition doesn't trigger automatically | Use the admin **Force advance** button to manually advance to the next puzzle. |
| State got stuck / players see wrong content | Click **↺ Reset session** on the admin screen to wipe everything and start fresh. |
| "puzzle1.html not found" error | Make sure `puzzle1.html` is in the same folder as `server.js` (repo root or `public/` subfolder). |
| Changes not appearing after a git push | Wait ~30 seconds for Render to redeploy. Check the Render dashboard for deploy status. |

---

## URL reference

All URLs use your deployed app domain (e.g. `https://your-app.onrender.com`).

| Purpose | URL |
|---------|-----|
| Start a session (facilitator) | `/room#admin` |
| Player screen 1 | `/room#screen2` |
| Player screen 2 | `/room#screen3` |
| Force room state reset | `/room#admin?reset` |
| Puzzle 1 standalone — Player 1 | `/puzzle1#p1` |
| Puzzle 1 standalone — Player 2 | `/puzzle1#p2` |
| Puzzle 2 standalone — Player 1 | `/#p1` |
| Puzzle 2 standalone — Player 2 | `/#p2` |
| Puzzle 3 standalone — Player 1 | `/puzzle3#p1` |
| Puzzle 3 standalone — Player 2 | `/puzzle3#p2` |
| Reset puzzle 1 mid-session | `/puzzle1?reset#p1` |
| Reset puzzle 2 mid-session | `/?reset#p1` |
| Reset puzzle 3 mid-session | `/puzzle3?reset#p1` |
| Local development server | `http://localhost:3000/room#admin` |
