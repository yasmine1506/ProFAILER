# DEER — Operations Guide

Two-puzzle networked escape room for research sessions. Two players on separate laptops, one facilitator (you) on a third screen.

| # | Puzzle | File |
|---|--------|------|
| 1 | Binary image classifier (bias) | `public/puzzle1.html` |
| 2 | The Xenolinguist's Dilemma (LLM hallucination) | `public/index.html` |

```
server.js        Node server (WebSocket sync + log collection + admin download API)
logstore.js      Reliable log storage (memory → disk → private gist)
public/room.html Room shell: session control, roles, admin "📥 Data" panel
public/index.html, public/puzzle1.html
EVENT_LOG_DICTIONARY.md   Every logged event + the summary columns
```

## 1. One-time setup on Render

1. **Create the log gist** (private): https://gist.github.com → file name `README.md`, content "DEER logs", **Create secret gist**. Copy the id from its URL (the long hex string).
2. **Create a token:** GitHub → Settings → Developer settings → Personal access tokens → *Fine-grained* (or classic with only the **gist** scope). It only needs permission to edit gists.
3. **Render → your service → Environment**, add:

| Variable | Value |
|---|---|
| `GIST_ID` | the gist id from step 1 |
| `GIST_TOKEN` | the token from step 2 |
| `ADMIN_KEY` | any long secret you choose (you type it once in the admin screen) |
| `SESSION_PREFIX` | optional, default `S` (session ids become S1, S2, …) |

4. Deploy (build `npm install`, start `node server.js`). On start the server prints `gist bootstrap OK`. If it prints `WARNING: GIST_ID / GIST_TOKEN not set`, logs live only on the server and **are lost on redeploy**.

> Render's free tier sleeps after 15 min idle — open `/room#admin` about a minute before players arrive.

## 2. Running a session

Open three screens: `/room#admin` (you), `/room#screen2` (player 1), `/room#screen3` (player 2).

0. **Trying things out yourself?** On the Session Setup screen click the green **● Logging ON** button to switch to 🧪 **test mode** (a yellow banner shows at the top). Test sessions are not saved, numbered or backed up. Switch it back ON before real participants. It can only be changed when no session is running, it needs your admin key entered in 📥 Data, and the server goes back to ON whenever it restarts.
1. Admin: pick puzzles → **Start Session**. The server numbers it (S1, S2, …). Every log row is tagged with that id.
2. Players click Agent 1 / Agent 2.
3. Admin: **▶ Start Puzzle 1**. Puzzle 2 starts automatically when puzzle 1 is completed.
4. **Force advance** moves to the next puzzle (recorded as `force_advanced` for that puzzle) or ends the session after the last one.
5. When the session ends the **📥 Data** panel opens by itself. Download the data (below), then press **↺ Reset session** before the next pair.

## 3. Getting your data (the 📥 Data button, bottom-left of the admin screen)

First time only: open **Admin key**, paste your `ADMIN_KEY`, Save.

- Per session: **events** (all rows from both puzzles, one file) or **summary** (one row).
- **All sessions — events / summary**: everything so far.
- The line at the top shows backup status: ✓ *Backed up to gist* means it is safe. A red ⚠ means the gist is failing (it keeps retrying; your data is still on the server and in the players' browsers). **Save to gist now** forces a push.
- The same files are also in your private gist: `S1_puzzle1_events.csv`, `S1_puzzle2_events.csv`, `S1.jsonl` (raw, used to restore the server) and `sessions.csv` (summary of all sessions).

**Before pressing Reset**, check the Data panel shows ✓ backed up.

### How data is protected
1. Each player's browser keeps its own copy and re-sends anything the server has not acknowledged (also after a dropped connection).
2. The server writes every row to disk **before** acknowledging it, then pushes to the gist within a few seconds (retrying until it succeeds, and once more on reset/shutdown).
3. After a restart or redeploy the server reloads every session from the gist and continues numbering (S4, S5…) without reusing ids.
Remaining risk: if the Render machine dies in the few seconds between a player action and the next gist push, only the players' browser copies exist; Ctrl+Shift+L in a puzzle tab downloads that copy.

## 4. Summary columns (`sessions.csv`)
`session_start/end/duration_sec` (end = session complete, else reset, else last event; `ended_by` says which) · per puzzle: `start`, `end`, `duration_sec`, `completed` (puzzle reported success), `force_advanced` (you pressed Force advance during that puzzle) · puzzle 1: `phase1_training_attempts` (classifier training runs), `phase1_scan_attempts`, `phase2_complete` · puzzle 2: `phase1_attempts_total`, `phase1_tx1_attempts`, `phase1_tx2_attempts`, `phase2_tx1/tx2_attempts`, `result`. `mode` = `standalone` means a puzzle was opened outside the room (testing).
Room timestamps use the **server's** clock.

## 5. Testing without the room
`/puzzle1#p1` / `#p2` and `/#p1` / `#p2` open a puzzle on its own (rows are saved as `standalone` sessions). Opening a file directly from disk (`file://`) works offline; use **Ctrl+Shift+L** in that tab to download its log (Ctrl+Alt+Shift+L = current session only). Add `?admin` to a puzzle URL to also auto-download the finished session when that tab is reset.

## 6. Troubleshooting
| Problem | Fix |
|---|---|
| Data panel says *ADMIN_KEY is not set* | Add `ADMIN_KEY` in Render → Environment, redeploy |
| *Wrong admin key* | Open **Admin key** in the panel and re-enter it |
| Red ⚠ gist error | Token expired or no gist permission, or wrong `GIST_ID`. Fix the variable; the server retries on its own |
| Players see wrong state | **↺ Reset session** on the admin screen (data is kept) |
| Players stuck on role selection | Reload their tab; roles are re-assigned from the server |
| Changes not live after `git push` | Wait ~30 s for Render to redeploy |
