# Channel ingest

The daily "did I post anything the distribution centre hasn't seen?" check.

Once a day it reads your own YouTube channel, finds any new live stream, and
runs it through the Stream Pipeline — the long-form edit, clips, the podcast
MP3, the carousel and the text posts, all of it — without being asked.

**It stops at "ready to schedule".** Nothing here publishes: every output lands
in the app for you to look at, and nothing goes out to a channel unreviewed.

By default only **live streams** are taken in. That is what the scheduled run is
for, and a stream is the thing worth fanning out into every format unattended.
`--all` widens it to ordinary long-form uploads too.

## The app has to be running

The pipeline lives in the app, and the scan drives it over HTTP
(`POST /api/pipeline` to start a run, `GET /api/pipeline` to advance it). It
does **not** import `@/lib/pipeline/runs` directly, and that is deliberate: runs
live in a `globalThis` Map flushed to `data/pipeline/runs.json`, so a second
process would load its own copy of that Map, advance runs the server cannot see,
and the two would overwrite each other's `runs.json`. Going through the API
keeps the server the single owner of run state.

Set `APP_BASE_URL` if the app is not on `http://localhost:3000`. The scheduled
script starts the app itself if nothing is listening.

## Running it

```bash
npm run dev             # the pipeline lives here — start it first

npm run ingest:dry      # decide and report, take nothing in
npm run ingest:scan     # the real thing: streams only
npm run ingest:scan:all # streams and ordinary long-form uploads
npm run ingest:ledger   # what has already been taken in
```

## From inside the app

The same scan runs on demand from the Channel ingest panel on `/agents`, and
from a live voice session ("check my channel", "take it in"). Both go through
`POST /api/ingest`, which starts it as a background job — one at a time — and
`GET /api/ingest` reports the ledger plus the running job's log.

That in-app path sets the base URL to the server's own origin before it starts
(`setAppBaseUrl`), rather than reading `APP_BASE_URL`. A sandbox worktree copies
`.env` verbatim, so a scan started on port 3100 would otherwise hand its streams
to the production app on port 3000.

Scheduled daily via `scripts/daily-channel-scan.ps1` (Windows Task Scheduler —
registration command is in the file's header). It runs locally rather than in
GitHub Actions because ingest needs yt-dlp, ffmpeg and the local `data/`
directory, and a multi-hour stream VOD is not something an Actions runner can
realistically pull.

A missed run is harmless: the scan looks back 7 days by default and the ledger
stops anything being taken twice.

## How a video is judged

Three independent guards stop the pipeline eating its own tail, or redoing work
it has already done, in this order:

1. **Provenance (exact).** Everything this app publishes to YouTube is recorded
   in the publish queue as `platforms.youtube.postId`. An id match is proof.
2. **Already in the pipeline (exact).** A video that is already some run's
   source has been taken in — whether a scan did it or you pasted the link
   yourself. Without this, the first scan on an established channel re-downloads
   and re-clips every stream you handled by hand.
3. **Shape (heuristic).** A vertical video of ≤ 3 minutes is a Short. This is the
   backstop for Shorts posted by hand from a phone, which never went through the
   queue and so have no postId to match.

Guard 2 reads `GET /api/pipeline` and extracts the video id from each run's
`sourceUrl`. A failed read is **not** fatal — provenance and the ledger still
stand — but it is warned about, because the consequence is an expensive
re-download rather than a wrong decision.

### Same title is not the same stream

A title can legitimately repeat across a day: a 12-hour hackathon broadcast in
two parts, or a stream that dropped and restarted, both titled "Day 23". These
are distinct recordings and each one is taken in. Nothing here collapses
candidates by title — the only "already handled" signals are the exact id
matches in guards 1 and 2.

Live streams skip the shape test entirely — a stream is never a Short, and its
VOD is the most valuable thing to clip.

| Situation | Outcome |
| --- | --- |
| `postId` in the publish queue | skip — the app published it |
| Already in the ledger | skip — an earlier scan took it |
| Already a pipeline run's source | skip — the pipeline has it |
| Not public | skip — a draft is not released content |
| Has `liveStreamingDetails` | **ingest** — stream VOD |
| Not a stream, live-only mode (default) | skip — `--all` to include it |
| ≤ 3 min and vertical | skip — Short |
| ≤ 3 min, frame shape unknown | skip, **flagged for review** |
| Anything else | **ingest** — long-form upload |

Live-only is checked *after* provenance and privacy, so the report keeps giving
the most specific reason rather than blaming live-only for everything it did not
take.

### Two deliberate judgement calls

**A failed read of the publish queue aborts the scan.** Returning an empty set
would look like "nothing was ever published" and leave the shape heuristic as the
only guard — which is exactly how the pipeline would start re-clipping its own
output. Better to skip a day than to eat the tail.

**An unreadable frame shape holds a short video back rather than ingesting it.**
Held-back videos are printed under "Held back for you to decide on", so they are
visible rather than silently dropped. The asymmetry is on purpose: taking one in
by hand is cheap, re-clipping a Short is the failure this whole thing exists to
prevent.

### Why the frame shape can be unknown

The YouTube Data API has no aspect-ratio field. `fileDetails` carries real pixel
dimensions but is owner-only and 403s the *whole* request when the token is not
the owner's, which would take the scan down with it. So the shape is derived from
the embed player instead: asking for `part=player&maxWidth=480` makes YouTube
compute the matching height for the video's own aspect ratio. It is a derived
signal and it is allowed to fail — hence the review path above.

## Retries

Only a **settled pipeline run** counts as done — every stage past waiting and
running, not just the long-form project. A failed or timed-out run stays
unsettled and is retried on the next scan, up to `MAX_INGEST_ATTEMPTS` (3), after
which it is reported under "Given up on" and left for you. That stops one broken
three-hour download from consuming every scheduled run forever.

A timeout is not a cancellation. The scan waits up to 4 hours for a stream to
fan out; past that it stops watching, but the app keeps working on the run and
tomorrow's scan sees the finished result.

If the app goes down mid-scan the run stops there rather than burning an attempt
on every remaining stream for the same reason — three unreachable days would
otherwise abandon the whole backlog.

## Files

| File | Role |
| --- | --- |
| `classify.ts` | the decision rules — pure, no I/O, where the correctness lives |
| `channelScan.ts` | reads the channel (3 quota units per scan) |
| `ledger.ts` | `data/channel-ingest.json` — what has been taken in, and retries |
| `pipelineClient.ts` | drives the Stream Pipeline over HTTP (see "The app has to be running") |
| `run.ts` | orchestration: scan → decide → run the pipeline → record |
| `cli.ts` | the terminal/scheduled-task entrypoint |

`channelScan.ts` is deliberately separate from `publisher/channelVideos.ts`. That
one answers "what is on the publish schedule" and drops everything that is not
scheduled-or-recently-public; this one needs every recent upload plus duration and
live-stream details.
