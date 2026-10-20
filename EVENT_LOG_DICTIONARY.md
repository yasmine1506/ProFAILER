# ProFAILER event log — data dictionary (Puzzle 1 & Puzzle 2)

One flat table per puzzle, **one row per player action**. Filter on `task` + `event`. Rows are never deleted; pairs are separated by `session`.
Rows are sent to the server as they happen and saved to your private gist; download them from the admin screen's **📥 Data** button (see OPERATIONS.md). The columns below are what the downloaded CSVs contain. (Fallback: **Ctrl+Shift+L** in a puzzle tab downloads that browser's own copy.)

## Common columns
| Column | Meaning |
|---|---|
| `session` | One code per pair's playthrough, assigned by the server when you press Start Session (`S1`, `S2`, …). Filter on this to analyze one pair. Rows from puzzles opened outside the room get a long `S2026…` code (testing). |
| `puzzle` | 1 or 2. |
| `seq` | Row number inside the session and puzzle. |
| `ts` | UTC timestamp from the player's own computer clock. Sort by this to see who acted first. |
| `elapsed_s` | Seconds since the session started (server clock vs player clock: can be a second or two off). |
| `puzzle_elapsed_s` | Seconds since that puzzle started. |
| `player` | `p1` / `p2` (from the #p1 / #p2 link). |
| `phase` | 1 or 2 (puzzle phase when the action happened). |
| `task` | What the action belongs to (see tables). |
| `event` | What happened (see tables). |
| `attempt` | Per player, per task: 1st, 2nd, 3rd… answer / scan / training run / sequence submission. |
| `choice`, `correct` | What was picked; `correct` = 1/0 (never an option position, option order is randomized in Puzzle 1). |
| `detail` | JSON with any extra fields for that event. |

## Puzzle 1 (`puzzle1.html`) — extra columns: `round`, `item`, `choice_label`, `cup_pct`, `book_pct`, `bias_score`, `books`, `mugs`
| task | event | What it logs |
|---|---|---|
| `train` | `train_model` | P1 trained the classifier. `round` = model number, `books` / `mugs` = the 3+3 images used (your code names, ` \| `-separated), `bias_score` = color-shortcut score (0–1) shown on the meter. |
| `scan` | `scan` | P2 scanned an object. `item` = scan object (orange-book, purple-book, laptop, pen), `round` = model it was scanned against (0 = facility's original model), `cup_pct`/`book_pct` = scanner result, `correct` = 1 if read as mug (door unlocked), plus that model's `books`, `mugs`, `bias_score`. |
| `diagnosis` | `answer` | Breach diagnosis choice. `choice` = `winning_attempt` / `decoy_attempt`, `correct` 1/0; `detail` holds both options' model round, item, scanner %. |
| `diagnosis` / `prediction` | `continue_clicked` | Player clicked Continue after finishing that step. |
| `prediction_model1`, `prediction_model2` | `answer` | Each drop of the test image into Book / Mug. `choice` = zone, `correct` 1/0, `item` = orange-book (model 1) or laptop (model 2). Every attempt is a row. |
| `bias_cause_model1` | `answer` | Which feature caused the bias (color / shape / background / angle). |
| `bias_term_model1` | `answer` | Name chosen for the problem (Training Bias is correct). `choice_label` = text shown. |
| `final_q1`, `final_q2` | `answer` | Final security questions. `choice`, `choice_label`, `correct`; `detail` = question text and asker. |
| `explainer` | `stage_view` | Player stepped through the 4-stage prediction explainer (`choice` = stage reached, `detail.dir` = next/prev). |
| `help` | `hint_opened` | Player opened the friend's hint message. |
| `help` | `info_opened` | Info box opened; `item` = `binary_classifier`, `bias_score`, `how_scanning_works`, `scan_log`. |
| `flow` | `page_loaded`, `premise_done`, `mission_begun`, `access_lab`, `diagnosis_started`, `puzzle1_complete`, `game_reset` | Progress markers. `game_reset` closes a session. |

## Puzzle 2 (`index.html`) — extra columns: `tx`, `item`, `positions`, `score`, `tier`, `step_probs`, `verdict`, `repeat`
Symbols are logged as **positions**: `T2R3` = Token 2 (column 2), row 3.
| task | event | What it logs |
|---|---|---|
| `learn_more` | `open` | Player opened the "learn more" (what is XENOX-7) box. |
| `response_log` | `open` | Player opened the response-sequences log. `tx` = which transmission (1/2), `phase` tells you Phase 1 vs 2. |
| `response_sequence` | `submit` | Player logged a response sequence. `positions` (e.g. `T1R3\|T2R4\|T3R2\|T4R5\|T5R1`), `score` = probability score (sum of step numbers), `tier` = highest/high/medium/low, `step_probs`, `verdict` = verified/hallucination, `repeat` = 1 if the same sequence was logged before, `attempt` = nth submission by that player for that transmission and phase. |
| `prediction` | `answer` | Phase 2 verified-vs-hallucination prediction. `tx`, `choice`, `correct` 1/0. Every attempt is a row. |
| `explainer` | `skip_next` | Player pressed ▶ "next part". `item` = `llm` (how XENOX-7 works) / `halluc` (why LLMs hallucinate); `detail` = parts moved from/to; `first_playthrough` = 1 if first watch (not a rewatch). |
| `explainer` | `seek` | Player dragged the timeline slider (**first watch only**). `detail` = from/to seconds, from/to part, forward/back. |
| `explainer` | `rewatch` | Player pressed a "Rewatch" button. `item` = `llm` / `halluc`. |
| `explainer` | `continue` | Player finished an explainer and clicked Continue. |
| `flow` | `begin_game`, `send_transmission`, `prediction_continue`, `game_reset` | Progress markers. `send_transmission`: `tx`, `verdict` (and `detail.result` = win/lose for Phase 2 TX2). |

## Notes for analysis
- "Copy vs independent": compare `ts` of the two players' rows for the same `task`/`tx`; > 5–10 s apart = independent. Use `attempt` = 1 for clean first answers.
- Puzzle 1 `bias_score` means *color shortcut* (new definition). Pre-October-2026 pilot data used the old metric: split by session date.
- Option order is randomized per player in Puzzle 1 (diagnosis, bias cause/term, final questions); only `correct` is logged.
- Rows come from each player's own browser; both copies are merged by row id.

## Session summary (`sessions.csv`, one row per session)
`session_id, mode, session_start, session_end, session_duration_sec, ended_by, puzzles_included, all_puzzles_completed` · for each puzzle `pN_included, pN_start, pN_end, pN_duration_sec, pN_completed, pN_force_advanced, pN_rows` · puzzle 1: `p1_phase1_training_attempts, p1_phase1_scan_attempts, p1_phase2_complete` · puzzle 2: `p2_phase1_attempts_total, p2_phase1_tx1_attempts, p2_phase1_tx2_attempts, p2_phase2_tx1_attempts, p2_phase2_tx2_attempts, p2_result`.
`pN_force_advanced` = 1 when the admin pressed Force advance during that puzzle; `pN_completed` = 1 when the puzzle itself reported success. Start/end/duration come from the server clock.
