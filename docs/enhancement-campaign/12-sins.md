# 12 Deadly Sins of CoLateral Marketing: campaign log

This log has one entry per landed slice of the plan in the CoLateral session output
`CoLateral-Marketing-12-Deadly-Sins.md` (2026-10-13). The twelve sins are:

1. silent death
2. blind publishing
3. no money trail
4. disk gluttony
5. a database made of JSON files
6. no backups
7. open doors
8. work that never lands
9. deaf to the audience
10. missing channels
11. autopilot without a pilot
12. built for one, sold to many

Waves 0 and 1 are done. Waves 2 to 4 (sins 2, 3, 9, 10, 11 and 12, plus SQLite for sin 5) are open.

## 2026-10-13 - Wave 0: operations on the production folder

- **TikTok parked.** The "Capital Command tiktok audit watch" task is disabled. It had logged
  `exit=11 SANDBOX` 306 times since 2026-08-20. The publish runner still defers TikTok items, and
  the runner logs now summarise them on one line.
- **Plaintext `.env` backups removed.** Seven `.env.backup*` / `.env.bak*` files moved from the
  repo root to `%USERPROFILE%\.capital-command-env-backups`, which only Nic can read.
- **Disk.** 740 long-form render intermediates (`export-<id>-{hook,body,merged,burned}.mp4`,
  `.ass`, `concat` and filter files) were deleted, along with 88 orphaned `*.tmp` files. Before
  deleting, each path was checked against the patterns `render.ts` writes and never reads back,
  an age over 24 h, a decodable final export, and no ffmpeg running. That freed 303 GB: C: went
  from 153 GB to 456 GB free.
- **Recovered temp files.** Three temp files held records missing from their live files and were
  moved, not deleted, to `%USERPROFILE%\.capital-command-recovered-tmp`:

  | File | Records |
  |---|---|
  | `threads-queue.json.40128.1786414703835.tmp` | 246 |
  | `threads-queue.json.58440.1785597364678.tmp` | 118 |
  | `jobs.json.9356.1782696255230.tmp` | 5 |

  Kept: the 26 legacy `*-captioned.mp4` files (56.7 GB) and every source, output and cache file.
- **Releases.** Nic asked for two releases, run with `update-app.ps1` (`717da39`, then `4a2eb41`).
  Before each one, both runner tasks were disabled and a stray `next start` holding port 3000
  without a pid file (PID 18776) was stopped by PID. Afterwards: one server on 127.0.0.1:3000
  matching `server.pid`, a cross-site POST to `/api/publish/run` gets 403, and
  `/api/health/platforms` lists Threads · nic_vandewetering as broken.
- **Backups.** `npm run backup:register` was run in production. The first backup was 245 files,
  21.6 MB, in `OneDrive\CoLateral Marketing Backups`.
- **Still Nic's.** The expired Threads token has to be regenerated in the Meta developer console
  and pasted into `.env` (`src/lib/threads/README.md` step 3). A token that has already expired
  cannot be refreshed.

## 2026-10-13 - Wave 1

| Slice | PR | Sin | What landed |
|---|---|---|---|
| 7a | #478 | 7 | `src/middleware.ts` refuses cross-site requests on every mutating `/api` route. A coverage test fails on any unguarded route. The Instagram webhook is the only exempt route, and it now requires a valid signature. `__pycache__` is untracked. |
| 8a | #479 | 8 | The 108-commit UX pass from 10-10/11 (Uploading Center, Day Summary, Threads board, phone tap targets, cadence editor) landed after an adversarial review of its 14 publishing-side changes. |
| 4a | #482 | 4 | Long-form, clip and Clip Editor exports delete their own intermediates. Renders refuse to start below `RENDER_MIN_FREE_GB` (default 40). ENOSPC on stdout no longer crashes the server. Adds `npm run data:prune` (dry run by default) and a disk line on Day Summary. |
| 6a | #480 | 6 | `backup:state`, `backup:restore` and `backup:register`. Nightly at 03:30 to Google Drive or OneDrive, keeping 14. Secrets are excluded and listed in the manifest. Day Summary shows the last backup. |
| 1a | #481 | 1 | Lands `7fddc81` (weekly Threads token refresh, recovery from a missing build). Adds a per-account auth breaker for Threads and the publisher adapters, the `/api/health/platforms` endpoint, an app-wide Reconnect banner, and a Windows toast from the runner tasks. |
| 5a | #483 | 5 | `atomicWriteJson` with an `O_EXCL` file lock replaces about 25 hand-written writers. Queue saves merge per item and per leg, and a delivered leg always wins, so a merge can never cause a double post. `claim()` re-checks under the lock. `.env` writes are atomic. Stale `*.tmp` files are swept at start. |
| 8b | #484 | 8 | The runner fallback starts the app through `start-server.ps1`, so it gets a pid file and logs. Logs are summaries, UTF-8, rotated daily and kept 14 days. The automation journal records changes only. The default build passes (64 s). |
| 8c | #485 | 8 | Server stdout logs one summary line per tick for deferred posts. |
| 1b | #486 | 1 | A token refresh rejected for auth (Threads, YouTube, TikTok) trips the account breaker without waiting for a post to fail. |

### Review rounds

- **#480:** this machine has no Google Drive, so OneDrive detection was added, plus a 2-day
  history window and retention of 14.
- **#481:** the breaker became per account, the refresh falls back to the documented query form,
  the Windows toast was added, and the banner was screenshotted.
- **#483, round 1:**
  - On a leg clash, the newer item `updatedAt` won the whole leg. That let a claim overwrite a
    published leg and post it twice.
  - `claim()` did not re-check whether the leg was still due.
  - The rename retry budget was too short.
  - A CLI `.env` read error was treated as an empty file.
- **#483, round 2:** a stale lock file that could not be removed made the acquire loop spin with
  no timeout. Fixed, with `file-lock-stuck.test.ts`.

### Open from Wave 1

- `claimBuffer` has no claim check.
- Old `publisher-*.jsonl` journals age out after 7 days but are not compacted.
- Prune's source pinning counts published queue items. A follow-up would pin only undelivered
  items.
