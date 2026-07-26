# Channel ingest

The daily "did I post anything the distribution centre hasn't seen?" check.

Once a day it reads your own YouTube channel, works out which uploads are new
original content, and takes those into the long-form pipeline as analyzed
projects. A live stream VOD or a talking-to-camera upload gets picked up. The
pipeline's own Shorts do not.

**Ingest stops at an analyzed long-form project.** Nothing here clips and nothing
publishes — new content lands in the app for you to look at, and never goes out
to a channel unreviewed.

## Running it

```bash
npm run ingest:dry      # decide and report, take nothing in
npm run ingest:scan     # the real thing
npm run ingest:ledger   # what has already been taken in
```

Scheduled daily via `scripts/daily-channel-scan.ps1` (Windows Task Scheduler —
registration command is in the file's header). It runs locally rather than in
GitHub Actions because ingest needs yt-dlp, ffmpeg and the local `data/`
directory, and a multi-hour stream VOD is not something an Actions runner can
realistically pull.

A missed run is harmless: the scan looks back 7 days by default and the ledger
stops anything being taken twice.

## How a video is judged

Two independent guards stop the pipeline eating its own tail, in this order:

1. **Provenance (exact).** Everything this app publishes to YouTube is recorded
   in the publish queue as `platforms.youtube.postId`. An id match is proof.
2. **Shape (heuristic).** A vertical video of ≤ 3 minutes is a Short. This is the
   backstop for Shorts posted by hand from a phone, which never went through the
   queue and so have no postId to match.

Live streams skip the shape test entirely — a stream is never a Short, and its
VOD is the most valuable thing to clip.

| Situation | Outcome |
| --- | --- |
| `postId` in the publish queue | skip — the app published it |
| Already in the ledger | skip — an earlier scan took it |
| Not public | skip — a draft is not released content |
| Has `liveStreamingDetails` | **ingest** — stream VOD |
| ≤ 3 min and vertical | skip — Short |
| ≤ 3 min, frame shape unknown | skip, **flagged for review** |
| Anything else | **ingest** — long-form upload |

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

Only a `ready` project counts as done. A failed or timed-out ingest stays
unsettled and is retried on the next scan, up to `MAX_INGEST_ATTEMPTS` (3), after
which it is reported under "Given up on" and left for you. That stops one broken
three-hour download from consuming every scheduled run forever.

## Files

| File | Role |
| --- | --- |
| `classify.ts` | the decision rules — pure, no I/O, where the correctness lives |
| `channelScan.ts` | reads the channel (3 quota units per scan) |
| `ledger.ts` | `data/channel-ingest.json` — what has been taken in, and retries |
| `run.ts` | orchestration: scan → decide → ingest → record |
| `cli.ts` | the terminal/scheduled-task entrypoint |

`channelScan.ts` is deliberately separate from `publisher/channelVideos.ts`. That
one answers "what is on the publish schedule" and drops everything that is not
scheduled-or-recently-public; this one needs every recent upload plus duration and
live-stream details.
