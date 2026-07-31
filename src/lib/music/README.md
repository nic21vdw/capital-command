# Music Studio (`/music`)

Background music written on demand by licensed models, landing in the same
library the Long-Form Editor pulls from.

## Why fal.ai and not Suno

Suno has **no official self-serve API** — as of July 2026 it is a partner-only
pilot. Every public "Suno API" is a reverse-engineered gateway, and two things
follow from that: Suno's terms forbid the automated access those gateways rely
on, and any commercial-use promise they make is one they aren't licensed to
give. For music going into monetized videos, that rights chain is the problem —
not the risk of a ban, since a gateway never touches your own Suno account.

fal.ai hosts these models under its own commercial terms, so there is a real
API, a real invoice, and a real licence behind the audio. That is the whole
reason this module targets fal.

Generating by hand at suno.com on a paid plan is still the cleanest rights
chain of all — download the MP3 and upload it in the Audio panel. This module
is for everything you'd rather not do by hand.

## One transport, five models

Every fal endpoint speaks the same three routes, which is why one client drives
five very different models:

```
POST https://queue.fal.run/{endpointId}   -> { request_id, status_url, response_url }
GET  {status_url}                         -> { status, queue_position }
GET  {response_url}                       -> the model's own output
```

Auth is `Authorization: Key <FAL_KEY>` — fal's scheme is `Key`, not `Bearer`.

**The polling routes are not under the submit path.** A job submitted to
`fal-ai/lyria3/pro` is polled at `fal-ai/lyria3/requests/{id}` — fal drops the
variant sub-path and keys the queue on `owner/app`. Polling the submit path
answers **405**, and fal's published OpenAPI schema documents that wrong path
for all three routes, so don't trust it here. Submissions hand back the exact
`status_url` / `response_url`; those are stored on the job and reused, and
`queueUrlBase` is only the fallback for records written before them.

`fal.ts` owns that transport. Everything model-specific lives in `models.ts` as
one registry entry per model:

| Model | Endpoint | Length | Vocals | Takes |
| --- | --- | --- | --- | --- |
| Lyria 3 Pro | `fal-ai/lyria3/pro` | model picks, up to 3 min | in the prompt | 1 |
| Sonilo v1.1 | `sonilo/v1.1/text-to-music` | 30–600s | none | up to 3 |
| ACE-Step | `fal-ai/ace-step` | 5–240s | lyrics field | 1 |
| MiniMax 2.6 | `fal-ai/minimax-music/v2.6` | model picks | lyrics field | 1 |
| CassetteAI | `cassetteai/music-generator` | 10–180s | none | 1 |

Adding a model is one registry entry: capabilities (so the studio form knows
which controls to render), a pure `buildInput`, and a pure `readAudio`. Both
are pure, so the registry is fully testable without the network.

The awkward parts are deliberately hidden behind that seam, so the studio's
Instrumental toggle means the same thing everywhere:

- Lyria has no instrumental flag — the instruction is appended to the prompt.
- ACE-Step marks an instrumental with the literal lyrics `[inst]`.
- MiniMax **requires** lyrics on a vocal track, so a blank lyrics box turns on
  its `lyrics_optimizer` rather than failing validation.
- MiniMax rejects a prompt under 10 characters, so a terse one gets padded.
- The audio comes back under `audio`, `audio_file`, or an `audios` array
  depending on the model.

## The flow

1. `brief.ts` turns a one-line idea into a title, style tags and a prompt —
   the "Write it for me" button. AI-written with a local heuristic fallback,
   the same pattern as the clip titler, so the button never depends on the AI
   gateway being reachable.
2. `jobs.ts` submits it and records the request in
   `data/longform/music/jobs.json`.
3. The studio polls `GET /api/music?requestId=…`. **Polling is what advances
   the job:** the poll that first sees `COMPLETED` downloads every take into
   the music library and records their track ids.

Every step is idempotent. A finished job returns its recorded tracks instead of
re-importing, and an in-flight map keyed by request id keeps two overlapping
polls from downloading the same take twice.

Like the pipeline runs and the Threads queue, that map lives in ONE process.
Anything outside the Next server must go through `/api/music` rather than
importing `jobs.ts` and getting its own copy.

## Config

| Variable | Meaning |
| --- | --- |
| `FAL_KEY` | One key for every model. Without it the studio lists the models and plays the library, but generating is off and says so. |
| `FAL_QUEUE_BASE` | Advanced: stand a proxy — or a local stub — in front of `https://queue.fal.run`. |

## The browsable folder (`scripts/music-library.mjs`)

The library stores every song as `data/longform/music/<id>/track.<ext>` — right
for the app, useless for browsing. `npm run music:sync` keeps a human-readable
mirror at `~/Music/Capital Command`:

```
Capital Command/
  Generated/<Model Label>/<Song Title>.<ext>   exported from the library
  Uploaded/<Song Title>.<ext>                  songs added by hand
  Drop-in/                                     put Suno downloads here
  Drop-in/imported/                            where they land once absorbed
```

`music:export` copies out, `music:import` uploads anything waiting in `Drop-in`
into the library, and `music:sync` does both — import first, so a song dropped
in comes back out under its model folder on the same run.

Both halves are idempotent. Export records each track id in a hidden
`.exported.json` manifest and skips anything still on disk, so re-running after
a generation batch copies only the new songs; import moves a file to
`Drop-in/imported/` rather than deleting it, so a failed upload is never lost.

The script talks to the app over `/api/longform/music` — it never imports
`@/lib/longform/music`, because the library index has the same one-process rule
as the pipeline runs and the Threads queue.

| Variable | Meaning |
| --- | --- |
| `MUSIC_LIBRARY_DIR` | Where the mirror lives. Default `~/Music/Capital Command`. |
| `CC_APP_URL` | The running app. Default `http://localhost:3000`. |
| `CC_REPO_ROOT` | Where `data/` lives, if the script runs from elsewhere. Default `process.cwd()`. |
