# DEER Analytics Setup

Session data is written to a **private GitHub Gist** as a CSV file (`sessions.csv`).
No new npm packages are required — the integration uses Node's built-in `https` module.

---

## One-time setup (15 minutes)

### 1. Create a private Gist

1. Go to https://gist.github.com
2. Create a **secret** (private) Gist
3. Filename: `sessions.csv`
4. Content: paste the header row below and save

```
session_id,session_start,session_end,session_duration_sec,puzzles_included,logging_enabled,p1_included,p1_start,p1_end,p1_duration_sec,p1_completed,p1_force_advanced,p1_training_attempts,p1_submit_attempts,p1_phase2_complete,p1_training_log,p1_scan_log,p1_p1_tags,p1_p2_tags,p1_justifications,p2_included,p2_start,p2_end,p2_duration_sec,p2_completed,p2_force_advanced,p2_phase1_tx0_attempts,p2_phase1_tx1_attempts,p2_phase1_tx0_log,p2_phase1_tx1_log,p2_verdict_tx0,p2_verdict_tx1,p2_phase2_tx0_attempts,p2_phase2_tx1_attempts,p2_phase2_tx0_log,p2_phase2_tx1_log,p2_result,p2_both_verified,p3_included,p3_start,p3_end,p3_duration_sec,p3_completed,p3_force_advanced,p3_generation_attempts,p3_hints_triggered,p3_phase1_log,p3_phase2_attempts,p3_phase2_results
```

5. Copy the **Gist ID** from the URL: `https://gist.github.com/YOUR_USERNAME/GIST_ID_IS_HERE`

### 2. Create a GitHub Personal Access Token

1. Go to https://github.com/settings/tokens → **Generate new token (classic)**
2. Give it a name like `DEER-analytics`
3. Select only the **`gist`** scope
4. Generate and copy the token (starts with `ghp_...`)

### 3. Set environment variables on Render

In your Render service dashboard → **Environment**:

| Key | Value |
|-----|-------|
| `GIST_ID` | The ID from step 1 |
| `GITHUB_TOKEN` | The token from step 2 |

Render will redeploy automatically.

---

## Using the toggle

When you open `/room#admin`, a new **"Research data logging"** section appears below the Start Session button:

- **Default: OFF** — sessions run normally but nothing is written to CSV.
  Use this for testing, debugging, and solo runs.
- **Toggle ON** before starting a session with real participants.
  The toggle must be set *before* clicking Start Session (or you can toggle it during a session — it takes effect at the moment the session row is written, when all puzzles complete).

If `GIST_ID`/`GITHUB_TOKEN` are not set, the section shows "Logging unavailable" instead of a toggle.

---

## Downloading your data

Go to your Gist URL and click **Raw** on `sessions.csv` to download.
Or open it directly in your browser — GitHub renders CSVs as a table.

**For SPSS/Excel:** download the raw CSV and import normally.
The puzzle log columns (`p1_training_log`, `p2_phase1_tx0_log`, etc.) contain JSON-encoded arrays.
In Excel, these can be left as text or parsed with Power Query if needed.

---

## Column reference

### Session-level
| Column | Description |
|--------|-------------|
| `session_id` | Auto-generated ID (`S` + timestamp) |
| `session_start` | ISO timestamp when admin clicked Start Session |
| `session_end` | ISO timestamp when all puzzles completed |
| `session_duration_sec` | Total session length in seconds |
| `puzzles_included` | Semicolon-separated list e.g. `1;2;3` |
| `logging_enabled` | `1` if logging was on, `0` if off |

### Per-puzzle (prefix `p1_`, `p2_`, `p3_`)
| Column | Description |
|--------|-------------|
| `pN_included` | `1` if puzzle was in this session |
| `pN_start` / `pN_end` | ISO timestamps |
| `pN_duration_sec` | Puzzle duration |
| `pN_completed` | `1` = natural win, `0` = did not win |
| `pN_force_advanced` | `1` = admin used Force Advance during puzzle |

### Puzzle 1 specific
| Column | Description |
|--------|-------------|
| `p1_training_attempts` | Number of times Agent 1 trained the model (rounds) |
| `p1_submit_attempts` | Number of times Agent 2 submitted phase 2 |
| `p1_phase2_complete` | `1` if phase 2 was completed correctly |
| `p1_training_log` | JSON array of training rounds with items, bias scores |
| `p1_scan_log` | JSON array of scan attempt strings |
| `p1_p1_tags` / `p1_p2_tags` | JSON: `{roundN: {verdict, feature}}` per player |
| `p1_justifications` | JSON: `{roundN: {player, verdict, feature, justification}}` |

### Puzzle 2 specific
| Column | Description |
|--------|-------------|
| `p2_phase1_tx0_attempts` / `p2_phase1_tx1_attempts` | Logged sequences per transmission in phase 1 |
| `p2_phase1_tx0_log` / `p2_phase1_tx1_log` | JSON: `[{seq, verdict, probs, n, count}]` |
| `p2_verdict_tx0` / `p2_verdict_tx1` | `verified` or `hallucination` |
| `p2_phase2_tx0_attempts` / `p2_phase2_tx1_attempts` | Phase 2 log counts |
| `p2_phase2_tx0_log` / `p2_phase2_tx1_log` | JSON: same structure as phase 1 |
| `p2_result` | `win` or `lose` |
| `p2_both_verified` | `1` if both transmissions were verified in phase 2 |

### Puzzle 3 specific
| Column | Description |
|--------|-------------|
| `p3_generation_attempts` | Number of story generations by Agent 1 |
| `p3_hints_triggered` | Count of hints shown (0–3) |
| `p3_phase1_log` | JSON: `[{meta, story, hint}]` — every generation |
| `p3_phase2_attempts` | Number of PARTS guessing attempts by Agent 2 |
| `p3_phase2_results` | JSON: `[{snapshot, results, attemptNum}]` — full attempt history |
