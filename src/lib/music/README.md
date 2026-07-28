# AI music (Suno)

Background music written on demand, straight into the long-form music library.
Type a vibe in the Long-Form Editor's **Audio** panel, and a couple of minutes
later the song is in your library with the first take already on the timeline.

## Why there's a gateway in the middle

Suno has **no official self-serve API**. In July 2026 Suno said it was
exploring a developer API with a curated group of partners; there is still no
public endpoint, no docs and no pricing. Everything usable today goes through a
third-party gateway that fronts Suno — sunoapi.org, kie.ai and others — and
they all speak the same two routes:

| | |
| --- | --- |
| Submit | `POST {SUNO_API_BASE}/api/v1/generate` → `{ data: { taskId } }` |
| Poll | `GET {SUNO_API_BASE}/api/v1/generate/record-info?taskId=…` → `{ data: { status, response: { sunoData: [{ audioUrl, … }] } } }` |

`suno.ts` is written against that shape with the host behind `SUNO_API_BASE`,
so switching gateways is one env var and an official Suno API would be a change
to one file.

Two consequences worth keeping in mind:

- **Rights.** Only songs generated on a paid Suno plan (Pro/Premier) come with
  commercial rights — that's a property of the account behind the gateway key,
  not of the key. Check the plan before a generated track goes into a monetized
  video.
- **Terms.** A gateway is not Suno. If a listing gets pulled or the shape
  changes, the Generate button fails with a clear message and uploading still
  works — the library is the same one either way.

## The flow

1. `brief.ts` turns the one-line idea into what Suno actually wants: a title, a
   comma-separated style tag list, and a prompt. Written by the AI gateway with
   a local heuristic fallback, the same pattern as the clip titler — the button
   never depends on the model being reachable.
2. `suno.ts` submits it. An instrumental with a style and a title goes as
   *custom mode* (the background-music case); anything else stays in
   description mode where the prompt is the whole brief.
3. `jobs.ts` records the task in `data/longform/music/suno-jobs.json`, and the
   browser polls `GET /api/longform/music/generate?taskId=…`. **Polling is what
   advances the job:** the poll that first sees `SUCCESS` downloads both takes
   into the music library and records their track ids.

Every step is idempotent. A finished job returns its recorded tracks instead of
re-importing, and an in-flight map keyed by task id keeps two overlapping polls
from downloading the same song twice — so the browser can poll as often as it
likes, and a closed panel abandons the loop, not the job.

Like the pipeline runs and the Threads queue, that map lives in ONE process.
Anything outside the Next server must go through `/api/longform/music/generate`
rather than importing `jobs.ts` and getting its own copy.

## Status values

`record-info` reports intermediate states whose names contain `SUCCESS`
(`TEXT_SUCCESS`, `FIRST_SUCCESS`) before any downloadable audio exists, so
`readJobStatus` treats only an exact `SUCCESS` as finished and anything with
`FAIL`/`ERROR` in it as failed. Everything else is still running.

## Config

| Variable | Default | Meaning |
| --- | --- | --- |
| `SUNO_API_KEY` | — | Gateway key. Without it the Generate button is off and explains why. |
| `SUNO_API_BASE` | `https://api.sunoapi.org` | Gateway host. |
| `SUNO_MODEL` | `V5` | Model version: V4, V4_5, V4_5PLUS, V5, V5_5. |
