# capital-command

Read `AGENTS.md` first. It covers how a change reaches the running app —
the production checkout stays on `main` and is never edited; work happens
in a sandbox worktree on a branch cut from `main`. The rest of this file is
subsystem conventions.

## Updating the app from inside it (`src/lib/release`)

The banner and the sidebar's "Check for updates" (above Settings) both offer
the release that `update-capital-command.bat` runs. `/api/update` reads the
status and starts the script; it never merges, rebuilds or restarts anything
itself.

- "There is an update" means THE RUNNING BUILD is behind `main`, not the
  checkout: `next start` serves `.next`, so a merge that never rebuilt is still
  stale. `status.ts` compares `.next/BUILD_COMMIT`, not `HEAD`.
- Only the production checkout on `main` may release, and `POST /api/update`
  re-checks that itself — the UI hiding a button is not the gate.
- CLEAR `.next/cache` with the rest. Keeping Next's incremental compile cache
  looks like free speed — a warm build is ninety seconds against nine minutes
  cold — but a warm build against the RELOCATED `.next` (reached through a
  junction, because OneDrive locks build output) fails in `Collecting page
  data` with `Cannot find module for page: /_document` or a missing webpack
  chunk. `start-server.ps1` then clears it and rebuilds cold anyway, so keeping
  it buys a failed build on top of the cold one. Measured twice. A sandbox
  worktree is not evidence here — it is outside OneDrive and builds in place.
- No validation is duplicated in TypeScript. `update-app.ps1` refuses a dirty
  or ahead checkout and backs out a conflicting merge; a second copy of those
  rules here would only go stale.
- The release kills the server running the request, so it must outlive it AND
  survive a tree kill: `run.ts` launches it through `Start-Process`, which
  gives it its own hidden console and an immediate orphan. Do NOT go back to
  `spawn(..., { detached: true })` — on Windows that PowerShell child exits 0
  without executing a line, which is how "Install and restart" appeared to
  work for weeks while doing nothing at all. `run.test.ts` guards it.
- The script writes `update-app.log` itself, given `-LogPath`. Redirecting the
  child's stdio cannot work once it has its own console, and an empty log is
  invisible: the banner shows the last `==> ` step and any `ERROR:` line, so a
  release that dies mid-way says so instead of spinning forever.
- THIS REPO HAS TWO REMOTES AND THEY ARE NOT THE SAME THING. `github` is where
  work lands — agent sessions merge pull requests there. `origin` is a local
  bare repository under `C:\Users\nic21\GitOrigin`, the backup hub for every
  one of Nic's repos, which `backup-to-github.ps1` syncs DOWN from GitHub on a
  schedule. Watching one of them is wrong in both directions: only `origin` and
  a merged pull request is invisible until the nightly backup, only `github`
  and a release made offline looks like it never happened. So `status.ts`,
  `update-app.ps1`, `dev-worktree.ps1` and `start-capital-command.bat` all
  enumerate `git remote` and take whichever copy CONTAINS THE MOST, by
  ancestry — never by date. The choice is `pickMostAdvanced` in `refs.ts`,
  tested there.
- THE RELEASE PUSHES TO EVERY REMOTE. Dating the changelog is a commit the
  release makes itself, and pushing it to only one remote is what made the two
  drift apart in the first place — `main` on GitHub and `main` in the backup
  each held commits the other did not, and every later release met them as a
  conflict in the one file every change touches.
- GITHUB IS OPTIONAL, still. Every fetch and push is best effort: a worktree
  shares this repository, so the commits are already local. Never let a network
  call become fatal — under `$ErrorActionPreference = "Stop"` a native command
  writing to stderr is a TERMINATING error, which is how an unreachable remote
  used to kill a release before it printed a word.
- One `ReleaseProvider` holds the status for the whole shell. Every check costs
  a `git fetch`, and two components polling separately would disagree on
  screen. Any new surface reads `useRelease()`.
- Decisions about what a surface SAYS live in `shared.ts`
  (`shouldShowBanner`, `updateCheckState`) and are tested there — every way of
  getting them wrong is silent, and that file is also the only half of the
  module the client bundle may import.

## Sourceflow Agents (`/agents`, `src/lib/agents`)

The agent command centre runs a bounded team of specialist model calls in
parallel, then asks an orchestrator to reconcile their work. Agent transcripts,
steps and approvals live in `data/agents/runs.json` through `dataPath()` and do
not belong in the main app-data document.

- OpenAI and xAI credentials stay server-side in `.env`; API responses expose
  only configured booleans and model labels.
- Model output never changes app state directly. It can only propose an action
  from the allowlist in `actions.ts`, and a user must approve that exact action
  before its validated executor runs.
- Publishing, token changes, deletes and scheduled-task registration are not
  agent tools. Do not add them without a separate fail-closed approval design.
- Keep provider transport behind `provider.ts`, team behavior behind
  `orchestrator.ts`, and durable history behind `store.ts` so the UI and model
  cannot bypass the safety boundary.

## Live voice (`/agents`, `src/lib/voice`)

A speech-to-speech session (OpenAI Realtime or Grok Voice) that can call app
tools while you talk. Read `src/lib/voice/README.md`.

- SUBSCRIPTION FIRST. Grok Voice runs on a SuperGrok / X Premium OAuth sign-in
  (`xaiAuth.ts`, device code against `auth.x.ai`, tokens in
  `data/voice/xai-oauth.json`), because a client secret minted with that token
  is billed against the subscription. `XAI_API_KEY` is the fallback, not the
  plan. OpenAI has no such route — ChatGPT Plus does not cover the realtime API
  — so it stays the second option. Do not make an API key the happy path again.
- The API key NEVER reaches the browser. `/api/voice/session` exchanges it for a
  short-lived vendor session secret and builds the whole `session.update`
  payload server-side, so provider quirks stay testable in Node.
- `tools.ts` is the allowlist and it is enforced twice: the action tools are not
  loaded into the session unless it is armed, and `/api/voice/tool` re-checks
  against a server-held grant. Publishing, scheduling, deletes, token changes
  and scheduled-task registration are not tools at all — same line as the agent
  team. Every action tool stops at "ready to schedule".
- A voice turn cannot wait on a four-hour fan-out: long tools start work, return
  an id and are polled.
- THE ORCHESTRATOR DOES THE WORK. Its failure mode is narrating — reporting a
  broken run back instead of fixing it — so every capability it describes must
  exist as a tool: `open_screen` puts a screen on the display, and
  `retry_pipeline_stage` / `render_topic_segment` start real work.
  `pipeline_run_status` returns `retryableStages`, which is what tells it what
  it may fix. When a new way of un-sticking a run appears in the UI, give it a
  tool too or the answer goes back to being advice.
- WHAT CAN BE RETRIED IS DECIDED ONCE. `repairable.ts` is a leaf (no store
  imports) and `runOverview` puts its answer on every overview as `retryable`,
  so the Retry buttons on the pipeline page, `POST /api/pipeline/<runId>` and
  the orchestrator all offer exactly the same set. Never re-derive it in a
  component.
- Repairs live in `src/lib/pipeline/repair.ts`, not in the tool layer. Every
  stage in `advanceRun` is guarded by a marker ("already tried and gave up"), so
  a repair CLEARS that marker and lets the run advance itself; the only special
  case is a long-form export left `processing` by a restart, which is retired
  first (`isExportRendering` is how a stalled render is told from a live one).
  The `podcast` stage is deliberately not repairable — retrying it would
  publish, and the orchestrator does not publish.
- Nic names streams, not ids. Pipeline tools take `runName` and resolve it
  themselves (`runReferenceFrom` tolerates whatever the model calls the
  argument); an ambiguous name comes back as a question, never a guess.

## Podcast / Spotify (`/podcast`, `src/lib/podcast`)

Every long-form edit also goes out as a podcast episode. Spotify has NO write
API for creators — the Web API is read-only and the Distribution API is open
only to licensed hosts — so the app IS the podcast host: it writes an RSS feed
to the same R2 bucket the publisher uses and Spotify pulls from it.

- Do not replace this with a headless-browser upload into Spotify for Creators.
  The feed is the sanctioned route, it is less work, and a scripted upload
  breaks on every UI change.
- ONE manual step, ever: submitting the feed URL once and clicking the link in
  Spotify's verification email. That is why a valid owner email is a hard
  requirement in `feedProblems` — a feed nobody can be emailed cannot be
  claimed, and it only fails after submission.
- The feed needs `S3_PUBLIC_BASE_URL`, not just the other `S3_*` variables. An
  RSS enclosure cannot be a presigned URL: those expire and Spotify re-reads the
  feed for the life of the show.
- `feed.ts` is pure and holds every rule Spotify judges the feed on (tags,
  ordering, escaping, `feedProblems`), tested without a network. `publish.ts`
  does the upload; `store.ts` owns `data/podcast/show.json`.
- The pipeline's `podcast` stage publishes as soon as the MP3 is cut, ONE
  attempt only — `podcastNote` is the "do not retry" marker, same rule as the
  extraction step above it, because a 2.5s poll drives both.
- Shorts never become episodes.
- See `src/lib/podcast/README.md`.

## Channel ingest from inside the app (`/api/ingest`)

The daily scan can now also be driven from the app — the voice console and the
Channel ingest panel both do it — as a background job in a `globalThis` map
(`src/lib/ingest/service.ts`), one scan at a time.

- The in-app scan talks to ITSELF, not to `APP_BASE_URL`: the route calls
  `setAppBaseUrl(request.nextUrl.origin)` first. Without that, a sandbox
  worktree on port 3100 would inherit `APP_BASE_URL=http://localhost:3000` from
  the copied `.env` and drive the PRODUCTION app's pipeline. Keep that call on
  any new entrypoint that starts a scan in-process.
- The CLI (`npm run ingest:scan`) is unchanged and still goes over HTTP, because
  it is a separate process and the pipeline's run map has one owner.

## Which stream a screen is about (`streams.ts`, `StreamProvider`)

Every Formats screen is a view of ONE recording, but each was a flat list of
everything the app had ever made, and the open run lived in the Pipeline page's
own state — so walking down the sidebar lost it and nothing on screen said what
you were looking at. `StreamProvider` holds that selection above the routes.

- `src/lib/pipeline/streams.ts` is the ONE place that maps a stream to each
  screen's piece of it. `STREAM_LINKS` may only name a param the target page
  ALREADY reads: a link carrying an id nobody reads is worse than no link,
  because the sidebar then claims a filter that is silently not applied.
- A stream with no piece on a screen yet gets the PLAIN href. `?longform=undefined`
  filters to nothing, which reads as "this stream made no carousel" when the
  truth is "not written yet".
- The list rides the badge's existing `GET /api/pipeline?summary=1` poll — the
  shell knowing what you are working on costs no extra request. The SELECTION
  is localStorage; the list is cached in sessionStorage because each route
  mounts its own `AppShell`, so the provider remounts on every navigation and
  would otherwise blink the name out and back in.
- Opening a run on the Pipeline page (`?run=`) IS choosing what you work on.
- Only leaf components read the query string, each behind its own `Suspense`.
  Putting `useSearchParams` in the provider prerenders EVERY page as an empty
  fallback.
- `next build` rejects `setState` inside an effect, so a screen syncing itself
  to a param derives it during render (a "last param" state that resets the
  manual pick) rather than an effect — see `clip-generator-page.tsx`.
- The nav label and the page title are the same words. They drifted on five of
  nine screens ("Short Clips" vs "Clip Generator"), which is most of why the
  app felt scattered. Keep them equal when adding a screen.

## Stream Pipeline (`/pipeline`)

One stream in (VOD link or uploaded file) → every format out, ready to
schedule. `src/lib/pipeline/runs.ts` is the orchestrator: a run stores a
shared clips source id plus references into the existing subsystems (the
long-form project, the clip job, the carousel, the publish queue) — it owns
no media of its own. `runOverview` both reports and ADVANCES the run
(auto-export the long-form edit when analysis is ready, extract the MP3 from
the finished export, write the carousel + text posts from the transcript),
so polling `GET /api/pipeline` is what drives runs forward and every step is
idempotent behind an id check.

- When a NEW output format is added to the app, wire it into the pipeline:
  a stage in `runs.ts` (+ `types.ts`), a row in
  `src/components/pipeline/pipeline-page.tsx`, and a count in the
  scheduler-stage summary.
- Pipeline runs are owned by ONE process: a `globalThis` Map flushed to
  `data/pipeline/runs.json`. Anything outside the Next server that wants to
  start or advance a run must go through the HTTP API (`POST /api/pipeline`,
  `GET /api/pipeline`) — see `src/lib/ingest/pipelineClient.ts`. Importing
  `@/lib/pipeline/runs` from a separate process (a CLI, a scheduled task)
  gives it a second copy of that Map and the two clobber each other's
  `runs.json`.

## What a stage says about itself (`runs.ts`, `repairable.ts`, `status.ts`)

- A SKIP BY DESIGN IS NOT A FAILURE. `stage("skipped", …)` means nothing to work
  from (no speech, one continuous topic, no audio track) and offers no retry;
  `gaveUp(…)` means it tried and failed, and that is what puts a Retry button on
  the row. Getting this wrong is a permanent amber banner and model calls that
  land back on the same skip.
- A step that fails `GIVE_UP_AFTER` times in a row stops being retried by
  `advanceRun` and reports as an error the user can act on (`run.failures`).
  Without it a deleted source left the stage saying "Creating the long-form
  project…" forever.
- `runListStatus` decides how a run reads in a list, and it is tested. A run
  with broken stages must never read as "Finished".
- The server advances runs on its own (`heartbeat.ts`, wired in
  `src/instrumentation.ts`). Polling from a page still works and still advances;
  the heartbeat is what covers a closed tab.

## The last mile (`queueOutputs.ts`)

"Ready to schedule" used to mean a person still had to schedule it, one clip at
a time, and the long-form video and its topic segments could not be scheduled at
all. `planRunOutputs` collects everything a run produced that has a file and is
not already in the publish queue; `queueRunOutputs` books them.

- Long video goes to `LONG_VIDEO_PLATFORMS` only. A ten-minute segment posted as
  a Reel or a TikTok is a rejection, not a post.
- AND IT IS NOT A SHORT. `enqueue({ format: "long" })` is what says so: the
  Shorts gate in `vertical.ts` (three minutes, 9:16) belongs to short-form posts
  and used to run on everything, which refused every long-form edit the pipeline
  ever produced. `format` defaults to `"short"`, so only the pipeline's
  `longform` / `segment` kinds opt out — and a long-form file is posted exactly
  as rendered, never reshaped.
- ONE OUTPUT PER SLOT (`assignSlots`, tested). The Uploading Center treats a
  taken slot as taken; double-booking is how one day posts twice and the next
  posts nothing.
- Dedupe is by resolved file path against the live queue, so pressing the button
  twice cannot queue the same video twice — and `enqueue()` refuses a duplicate
  underneath it either way (see below).
- The first slot offered is TOMORROW's, never one left in today.
- One failure never stops the rest, and every failure is named back to the user
  — a silent gap here is a day with nothing posted.
- Nothing here publishes. It writes the same queue the Uploading Center writes,
  at a future slot, for the publish runner.
- `queueWhenReady` is a STANDING instruction set by the button, drained by the
  heartbeat (`queueReadyOutputs`) and cleared when the run settles. It exists
  because the click happens while segments are still rendering. It can only
  book what the same plan would have booked, deduped by file path, so it can
  never queue something twice or something he unticked in a later plan.

### Car yaps are already on YouTube (`carYaps.ts`)

The "Yapping Until I Can Buy a Nicer Car" series is posted to the channel live.
An edit of one booked back to YouTube spends a daily upload slot to duplicate
what is already there — 17 were booked and pulled by hand on 2026-08-20 — and
the pipeline makes another every time a car yap runs through it. `collectLongform`
refuses them by title, whatever their length. The Instagram vertical cut of a
car yap is a different thing and is wanted; only the YouTube long-form booking
is refused.

## Two things the publisher must never do (`schedule.ts`, `duplicates.ts`)

A batch booking once put a run's whole output onto the channel inside one
morning — the same shorts more than once — and YouTube locked the account out of
uploading for the rest of the day. Both halves of that are now rules with a leaf
module each, and BOTH are enforced at `enqueue()`, the one door every route into
the queue goes through (Uploading Center, the editor's Schedule Short menu, the
pipeline's booking sheet, the ingest scan, the CLI, `/api/publish`).

- NOTHING IS SCHEDULED FOR THE DAY IT IS BOOKED. The earliest slot is TOMORROW
  in `PUBLISH_TIMEZONE — `schedule.ts` says so, `generateSlots` marks a slot
  `bookable`, and every picker, the auto-assign, the agenda board and
  `planRunOutputs` filter on that field rather than on `past`. A picker can be
  bypassed, so `enqueue()` refuses a same-day time outright; `allowSameDay` is
  for a person typing it, never for anything automatic. The rule is about the
  CALENDAR DAY, not a number of hours — "24 hours out" would still let two
  batches land on one day.
- NOTHING IS QUEUED TWICE. `duplicates.ts` asks whether the queue already
  carries these bytes (the file, its pre-vertical original, every picture of a
  deck) or the same clip retitled (same `jobId`, same normalized title). A
  fully-failed post is not a duplicate — re-scheduling it is the point.
- A YOUTUBE ITEM UPLOADS THE MOMENT IT IS QUEUED (`queue.duePlatforms` — that is
  what makes the schedule survive downtime), so booking three weeks ahead still
  sends every file today. The runner therefore stops at
  `YOUTUBE_DAILY_UPLOAD_BUDGET` uploads per quota day and reports the rest as
  `deferred`: untouched, unclaimed, no attempt counted, sent after the reset.
  The cap counts FRESH uploads only — resuming or finalizing a video that is
  already on the platform is not a new upload.
- The channel itself is the last check (`duplicateGuard.ts`): a video whose
  title is already up in the last 30 days is not uploaded again. It fails OPEN
  — a 403, a timeout or an empty read must never stop a legitimate post. The
  matching audit is `GET /api/publish/youtube-channel/duplicates`, which reports
  repeated titles on the channel and repeats on the queue, and changes nothing.

## Automatic channel ingest (`src/lib/ingest`)

A daily scan reads the YouTube channel and runs each NEW LIVE STREAM through
the whole Stream Pipeline unattended, stopping at "ready to schedule" — it
never publishes, UNLESS `settings.autoScheduleOvernight` is on. That one
setting is the only thing that lets an unattended run book its outputs into
the publish and Threads queues (which do post, at their slots, with copy he
has not read), it is OFF unless he sets it, and the decision is made
server-side in `POST /api/pipeline` — never taken from the request, because
the scan asks for it every time. Any single run can still be stopped from its
Scheduler row. Live streams only by default (`--all` widens it to ordinary
long-form uploads). Two guards stop it re-ingesting the app's own output:
exact provenance (`platforms.youtube.postId` in the publish queue) and a
Shorts shape heuristic. The ledger (`data/channel-ingest.json`) records what
has been taken in; only a SETTLED pipeline run counts as done, so a timeout
is retried rather than lost. See `src/lib/ingest/README.md`.

## Threads autopilot (`src/lib/threads`)

A scheduled task ticks every few minutes; each tick plans today's batch if it
isn't on the queue yet (DeepSeek writes the pack via `ensureDailyPack`) and
posts whatever is due. Both halves are idempotent, which is what makes a dumb,
frequent scheduler safe.

Each connected Threads account posts ONE version of every idea — the pack's
punchy `text` or its warmer `threadsVariant` — which is why the pack writes
both. Two accounts posting the same wording would read as mirrored spam.

- The app owns `data/threads-queue.json`. Anything outside the Next server
  (CLI, PowerShell task) must go through `/api/threads`, never import
  `@/lib/threads/queue` — a second in-process copy clobbers the app's writes,
  same trap as the Stream Pipeline.
- A BADLY missed slot is skipped, and past slots are never scheduled. The whole
  point is that an offline morning can't dump a backlog into the feed — but
  "never fired late" is too strong, and stating it that way put a false promise
  on screen once. Two things soften it, both on by default: `lateGraceMinutes`
  (`THREADS_LATE_GRACE_MINUTES`, 45) still sends a slot that is merely late,
  and `catchUpToday` (`THREADS_CATCHUP`) RE-LAYS a day that fell behind across
  the hours left in it. Preserve the spirit when touching `runner.ts` /
  `plan.ts`, and read the config before describing this in the UI.
- A slot is past/future by its OWN time, never the per-account offset, so the
  accounts can never drift out of step at the edges of the day.
- Planning is CHECK, generate (minutes), then APPEND — three steps, not one
  atomic write. The append re-checks that nothing landed on the day meanwhile
  and drops its own batch if it lost the race; without that, two overlapping
  ticks each see an empty day and every slot gets posted twice.
- Never put a token in an API response or a log line — the route exposes only
  each account's id, label, version and offset.
- A post that did NOT come from the daily pack is marked `origin: "pipeline"`,
  and every autopilot decision reads `autopilotItemsForDate`, never
  `itemsForDate`. Counting an ad-hoc post as the day's batch would make the
  planner skip writing the pack — the one thing this module exists to do. UI
  surfaces keep using `itemsForDate`, so the post is still visible.
- See `src/lib/threads/README.md`.

## Launch Pad (`src/lib/launch`)

Product Hunt launch planning at `/launch`. Product Hunt has NO write API for
creating a launch, so this module never publishes — it dates a playbook
backwards from launch day, writes the listing copy, and reads the live standing
back once the listing exists. Submitting stays manual on purpose.

- The checklist is DERIVED, never stored: `LAUNCH_PLAYBOOK` holds `offsetDays`
  per task and `buildLaunchPlan` dates them off `launch.launchDate`. Only the
  completed task ids are persisted, so editing the playbook updates every
  launch and moving the date moves the schedule. Keep it that way.
- Rank is read off the day's vote-ordered leaderboard because the API has no
  rank field; outside the top 20 it must return null, never a guess.
- Launches live in `AppData.productLaunches` and go through `/api/data` like
  every other collection. `/api/launch` generates copy and reads Product Hunt;
  it never writes.
- See `src/lib/launch/README.md`.
## Music Studio (`/music`, `src/lib/music`)

Background music written by licensed models hosted on fal.ai. One key
(`FAL_KEY`), one queue transport (`fal.ts`), and a registry (`models.ts`) that
holds everything model-specific.

- LICENSED PROVIDERS ONLY. Suno has no official self-serve API; every public
  "Suno API" is a reverse-engineered gateway whose commercial-use promise it
  isn't licensed to give, which is the wrong footing for monetized videos. Do
  not reintroduce one. Manual Suno + upload stays the cleanest rights chain.
- Adding a model is ONE registry entry: capabilities (the studio form renders
  itself from them), a pure `buildInput`, and a pure `readAudio`. Keep both
  pure — the whole registry is tested without the network.
- Per-model quirks belong behind that seam so the studio's Instrumental toggle
  means one thing everywhere: Lyria has no flag (append to the prompt),
  ACE-Step uses `[inst]`, MiniMax needs `lyrics_optimizer` when a vocal track
  has no lyrics, and audio comes back under `audio` / `audio_file` / `audios[]`.
- Generated tracks land in the SAME library as uploads
  (`src/lib/longform/music.ts`); only `MusicTrack.origin` differs. Don't build
  a parallel store.
- fal's POLL routes are NOT under the submit path: a job sent to
  `fal-ai/lyria3/pro` is polled at `fal-ai/lyria3/requests/{id}` (405
  otherwise), and fal's own OpenAPI schema documents this wrong. Store the
  `status_url` / `response_url` a submission returns and reuse them.
- Polling `GET /api/music?requestId=…` is what ADVANCES a job — the poll that
  first sees `COMPLETED` imports the takes — so every step is idempotent behind
  the ledger plus an in-flight map, same rule as the Stream Pipeline: the job
  map lives in one process, outsiders go through the HTTP API.
- See `src/lib/music/README.md`.

## Long-form topic segments vs short-form clips

A stream is several videos. `src/lib/longform/topics.ts` reads the transcript
and splits the recording into the 3-5 subjects it actually covered (lexical
cohesion — vocabulary turnover marks where one subject ends), each one roughly
ten minutes and each exportable as its own long-form upload. `projectForTopic`
in `plan.ts` renders one by clipping the project's timeline to that window and
moving the hook onto its opening, so segments go through the SAME export engine
as the full edit (cuts, captions, overlays, mix) and nothing downstream needs a
special case.

- Topic segments and short-form clips are independent selections over the same
  transcript, and must stay that way: the Clip Generator scans the whole stream
  for its best 30-second moments wherever they fall; topic segments carve the
  stream into whole subjects. Neither constrains the other.
- Topics need a transcript of the WHOLE recording. Long-form analysis only
  transcribes the opening of a long source (that is all the hook needs), so
  `planProjectTopics` falls back to the full transcript the clip job made from
  the same `sourceId`; the pipeline plans the segments once that lands.
- Segments are planned automatically but rendered on demand — auto-rendering
  five ten-minute videos per stream is hours of encoding nobody asked for.
- EIGHT MINUTES IS THE FLOOR (`length.ts`, `MIN_LONGFORM_SEC`). It is where a
  YouTube upload can carry mid-rolls, so it is what "long-form" means here:
  `planTopicSegments` never returns a window under it, `queueOutputs` refuses to
  book a shorter export as a long-form upload, and the editor warns before the
  render. A forty-second project was rendered, booked and posted as a long-form
  video on 2026-08-19 — that is the hole this closes. A hand-made request for
  `count` segments still overrides the floor, because it has already decided how
  long they are.
- A SEGMENT'S WORDS COME FROM THE WHOLE RECORDING (`withFullTranscript`). Long
  sources are only transcribed as far as the hook needs, so `project.transcript`
  covers the opening minutes and nothing else; a segment hours in had no words
  to burn and opened on silence. The render reads the shared source transcript
  for a segment render and never stores it — a four-hour transcript is megabytes
  and `projects.json` is rewritten on every save.
- EVERY SEGMENT OPENS LIKE ITS OWN VIDEO (`segment-review.ts`). `projectForTopic`
  hands each segment the project's hook settings, so one switch left off opens
  all five of them flat. The review reads each segment the way `hook-review.ts`
  reads the whole edit — the opening line's strength AND whether the treatment
  is actually on (burned-in words, motion, a push-in over 1.03x) — and stores
  the verdicts on the project as `segmentReviews`.
- CAPTIONS SIT IN THE LOWER THIRD, both the hook's and the body's. The middle of
  a 16:9 upload is the screen-share, the editor and the face; words burned over
  it hide the video they are about. The hook still reads as a hook through size,
  weight and the push-in, not through where it sits.

## Clip metadata conventions (titles, descriptions, tags)

Clip titles are NEVER raw transcript fragments — a slice of what was said
reads as a broken, mid-sentence thought. Titles are written by Claude in
`src/lib/clipping/titles.ts`, which carries the channel's title style guide:
a system prompt with example titles plus the recurring keyword set (AI, vibe
coding, Claude, ChatGPT, AI agents, coding, SaaS, startup, business,
building in public, engineering, automation). The heuristic titler in
`src/lib/clipping/editor.ts` (`generateClipTitle`) is only the offline
fallback when no API key is configured or the call fails.

- Apply the SAME approach to any future clip/video metadata generation —
  descriptions, tags, hashtags: reuse `CHANNEL_KEYWORDS` and
  `TITLE_STYLE_EXAMPLES` from `titles.ts` and write viral, keyword-aware
  copy with Claude rather than slicing the transcript.
- Every generated clip shows its title in white text centered just above
  the video band (over the blurred fill) by default: the ready-to-post
  render burns it in (`writeClipDownloadAss` + `buildClipTitleDialogue` in
  `captions.ts`), and fresh editor projects seed the matching white text
  overlay (`makeTitleOverlay`).

## Clip previews: center + blur, always the whole frame

Every surface that shows a clip renders through `ClipFrame`
(`src/components/clips/clip-frame.tsx`), never a bare `<video>`. It reproduces
the center + blur composition `renderCaptionedVertical` burns into the
ready-to-post file: the whole frame `object-contain` over a blurred, dimmed
copy of the same footage.

- CENTER + BLUR IS PUNCHED IN, and one constant says how far:
  `DEFAULT_CENTER_BLUR_ZOOM` in `src/lib/clipping/centerBlur.ts` (a leaf, no
  imports, tested). Dropping the whole widescreen frame into the middle of a
  9:16 canvas left the footage as a thin band with blur taking the rest of the
  height, so the centred copy is zoomed and the extreme left and right edges of
  the source are given up ON PURPOSE. Everything reads that one number: the
  ready-to-post render (`verticalCompositionChain`), the Clip Editor's export
  and live preview through `reframe.scale` (which is why a new project is
  created at that zoom, not 1), the burned title's position
  (`centerBlurVideoTopFrac`, used by `framingVideoTopFrac` too), and `ClipFrame`.
  It is an OPTION, not a law — the editor's Zoom slider goes back to 1.00x for
  the full width of the source.
- NEVER `object-cover` on a clip — it crops to the box's shape, throwing away
  whatever the render kept. `ClipFrame` reproduces the punch-in with a plain
  `scale()` over `object-contain`, capped at `centerBlurCoverScale` so a file
  that is ALREADY the shipping 9:16 shape is not zoomed a second time.
- NEVER let a clip letterbox onto the card background — black bars are the bug
  this exists to prevent. A tile has to look right whichever file is backing
  it: the finished 9:16 render (`downloadFile`), the instant 16:9 preview
  published before the HD render lands (`previewFile`), or the neutral master
  of an older job whose ready render never happened (`file`).
- Preview boxes are a full `aspect-[9/16]` — the shape the clip posts in — so
  nothing is cut off. Use `aspect="16/9"` only when the subject genuinely is a
  widescreen master (e.g. an editor project's source).

Center + blur is the FALLBACK composition, not the target one — see
auto-framing below. It is still what `ClipFrame` must be able to show, because
a clip whose speaker could not be found is composed exactly that way, and
because the preview has to look right for a 16:9 master too. `compositionMode`
still defaults to `"center-blur"` at project creation (`editor.ts`) and on load
(`schemas.ts`). `DEFAULT_CLIP_LAYOUT` in `layouts.ts` is `"restream-stack"`,
but that is only a parameter fallback for the opt-in layout-variant helpers —
it is NOT a shipped default, so don't "fix" it into `center` and change what
the variants mean.

## Auto-framing a clip on the speaker (`subject.ts`, `framing.ts`)

A short that shrinks a whole widescreen recording into the middle of a 9:16
frame reads as a downscaled desktop. The ready-to-post render instead gives
the frame to whoever is talking: `planClipFraming` (`autoframe.ts`) locates
the speaker and picks one of three compositions, and `renderCaptionedVertical`
takes the result.

- Detection is dependency-free and offline: ffmpeg decodes the section once
  into a 192x108 raw RGB strip and `subject.ts` works on a cell grid over it.
- What separates a person from a screenshare is NOT skin tone — warm syntax
  highlighting, a beige sidebar and a photo on a web page all pass a skin
  test. It is skin tone that MOVES CONTINUOUSLY, accumulated across the whole
  clip (`speakerMap`). Text changes in bursts, a photo never changes at all.
  Measured on real streams, that product leaves the camera as the brightest
  thing in the frame. Don't "simplify" it back to a per-frame skin search.
- Per-frame tracking only searches INSIDE the region the clip-wide map found,
  so a face on the screen can never pull the crop across the frame.
- Three modes, and the fallback is load-bearing: `subject-fill` (crop 9:16
  around the speaker, fill the frame, pan with them), `speaker-stack` (a small
  camera on a screenshare — lead with the DETECTED camera region instead of
  the hardcoded corner guess, screen kept as a banner), and `center-blur` when
  confidence is low. Detection failure must always land on the last one:
  `planClipFraming` never throws.
- Only crop's `x`/`y` may vary with time. Its `w`/`h` are evaluated once at
  graph-config time where `t` is NaN, so the window SIZE is fixed per clip and
  only its position is keyframed (`keyframeExpression`).
- The burned title has no letterbox to sit above once a clip is full-bleed —
  `framingVideoTopFrac` is what tells `writeClipDownloadAss` where the footage
  starts under each mode.
- The Clip Editor reaches the same decision through
  `POST /api/clips/<jobId>/autoframe`, which answers in the editor's OWN
  settings (`framingToReframe` → `crop-fill` scale/offset, or the camera-lead
  layout plus a `faceSource`). That is deliberate: the live preview and the
  export already render those, so auto-framing needs no second code path.
## Carousels (`/carousels`)

Slide copy is written by `src/lib/studio/carousel.ts` from a script, a
long-form transcript (which is what the Stream Pipeline produces), a clip, an
uploaded photo batch, or pasted text. Deck sizing lives in
`src/lib/carousels/deck.ts` — imported by BOTH the page and the generator, so
the picker can promise what the server will do.

- One source can produce several carousels in a pass. Each batch gets its own
  angle from `CAROUSEL_ANGLES` and they run concurrently; a single batch is
  asked for with no angle and no batch record, which is what keeps the
  pipeline's unattended carousel exactly as it was.
- Every slide is set in Arial (`SLIDE_FONT_STACK` in `src/lib/carousels/render.ts`,
  with metric-compatible fallbacks behind it). The canvas renderer and the
  editor's live text overlay both read that one constant — change it there, not
  per call site, or what you drag stops matching what exports.
- EMOJI ARE PICTURES, NOT GLYPHS. No font in that stack has an emoji in it, and
  the SERVER has no emoji font at all — a deck booked into the publish queue is
  painted by `@napi-rs/canvas`, so every emoji the copy asked for came out as
  empty space while the browser preview looked fine. `src/lib/emoji/apple.ts`
  splits a line into text and emoji runs and names the Apple image for each;
  `render.ts` measures and paints those runs itself (which is also why wrapping
  cannot go back to a plain `measureText` on the whole string), the browser
  loads them `crossOrigin="anonymous"` so the export can still make a blob, and
  the server reads them from `data/emoji-apple` through
  `src/lib/carousels/emojiFiles.ts`. SEVERAL filenames are tried, not one, and
  each was a glyph that came out blank until it was added: `emoji-data` keeps
  U+FE0F for some glyphs (🛠️ is `1f6e0-fe0f.png`) and drops it for others, and
  zero-pads codepoints below U+1000 (1️⃣ is `0031-fe0f-20e3.png`, which is every
  keycap a numbered listicle is made of). There is no rule to derive — probe the
  CDN before assuming a name.
- A CHANGE TO THE PAINTER MUST BUMP `PAINTER_VERSION` in `deckFiles.ts`. Decks
  already rendered to `data/carousel-decks` are served from disk and their
  slides are unchanged by a fix to how they are drawn, so without the bump the
  old pictures are what gets posted.
- A still is FRAMED, never cropped (`fit: "frame"`, `attachSlideBackdrops`).
  Cropping a 16:9 frame to fill a 4:5 slide throws away 55% of its width from
  the middle out — which is the half the webcam is in, so the deck became a zoom
  into the middle of a screen share with Nic's face sliced off the edge. The
  whole frame sits high in the slide over a blurred fill of itself, with the
  copy band under it, so the face AND the editor AND the terminal are all in
  shot. Same rule as clips: never `cover` footage. `FRAME_POSITION` is read
  exactly as CSS `object-position` reads it, because the editor's live overlay
  IS an `object-position` — anything cleverer has no CSS equivalent and the two
  silently drift apart.
- THE COPY IS SIZED TO ITS BAND, not set at a fixed size (`fitCopy`). A photo
  slide's band is the strip under the picture and the generator is allowed a
  220-character body, which is more lines than that strip holds — so the block
  was drawn straight past both ends of it, heading onto the picture and the last
  body line through the accent bar. Wrapping changes the line count, so the size
  is re-measured after each step down rather than solved once.
- LOOK AT A DECK BEFORE IT GOES OUT. `npm run carousel:proof` renders a stored
  carousel to the exact files the publisher would post and prints their paths
  with each slide's copy. Both defects above shipped for weeks because nothing
  ever opened the picture — a passing `npm test` says the geometry is right, not
  that the slide has words on it.
- A carousel written from a RECORDING is illustrated with the recording, and
  the COPY IS WRITTEN FIRST. The model is given a timestamped transcript of the
  whole stream (`transcriptDigest` thins it, never truncates — a 9k-character
  slice meant eight slides were written out of the first thirteen minutes) and
  returns an `atSeconds` per slide; `anchorSlides` in
  `src/lib/carousels/anchors.ts` turns those into the seconds the stills are cut
  at, falling back to matching the slide's own words against the transcript and
  then to an even spread. Never illustrate before the copy exists: spreading
  stills evenly puts the agent-terminal slide on whatever was on screen at
  minute 32, which measured 4.8/10 for relevance against 8.6/10 anchored.
- Stills are still CHOSEN, not grabbed — several candidates around the anchor
  are scored on exposure, detail and sharpness, near-duplicates are pushed down,
  and a slot with only black/blurred candidates gets no picture rather than a
  bad one. `attachSlideBackdrops` lays the winner behind the copy under a scrim.
  The candidate window is deliberately NARROW (`CANDIDATE_SPREAD_SEC`): a
  screen-share is a different application ten seconds away, so wandering to find
  a prettier frame breaks the anchor — widening it to ±10s took a slide from 9
  to 2.
- Then the still is LOOKED AT. `relevance.ts` shows the top candidates to a
  vision model with the slide's words and takes the BEST-rated one if it clears
  8/10; if none do, that slide gets no picture. Best-rated, not first-to-pass:
  the candidates are seconds apart and differ only in the instant caught, so
  that comparison is what steps off a blink or a hand across the face. Anchoring alone cannot tell a crossfade, a
  blink, or "the transcript is right there" sitting on a music generator — every
  failure left after anchoring was a question about what is IN the frame. It
  runs on `FAL_KEY` (the free text gateway refuses images) and fails OPEN: no
  key, or a dead endpoint, and the looks-only pick is used exactly as before.
- `ExtractedFrames.images` is POSITIONAL and may contain nulls. A rejected slide
  must keep its place — pushing the next slide's picture back onto it is how one
  bad frame becomes eight wrong ones.
- `scripts/eval-carousel-frames.ts` is how that number is checked: it runs the
  real path over a stored source and writes each slide's copy next to its still,
  for a person (or an agent) to score. Re-run it after touching the prompt or
  the picker rather than guessing — this pipeline is stochastic, one deck is not
  evidence, and two changes made on intuition here each made it measurably
  worse. `scripts/calibrate-relevance.ts` is the matching check for the gate:
  it re-rates frames whose true score is already known, which is the only way to
  tell a gate that works from one that passes everything.
- Uploaded photos land on disk (`data/carousel-images`, served by
  `/api/studio/carousels/images/<id>`), never inline as data URLs — a batch of
  base64 photos in `data/capital-command.json` would be re-read and rewritten
  on every app-data operation.
- Every uploaded photo gets its own slide: `resolveSlideCount` raises the deck
  to the photo count, and a short model reply is padded rather than dropping
  photos. The model never sees the photos — the description box is how it knows
  what they show.
- A photo takes the top of the slide and the copy stays in `heading`/`body`
  with a `textBand` under it, so one photo slide still renders correctly at
  4:5, 1:1, 9:16 and 16:9 without being laid out per ratio.

## Remotion / motion video conventions

When asked to make a "motion video" (a new Remotion short/segment), the
video is not done until it's wired into the app's Segment Deck, not just
committed as a standalone project under `video/`.

- Standalone Remotion projects live under `video/<project-name>/` (own
  `package.json`, `Root.tsx`, `Video.tsx`, `src/scenes/`, `src/components/`)
  — see `video/vibe-coding-first-steps/` as the reference layout.
- The Segment Deck (`src/app/presentation/deck.tsx`) is the in-app viewer —
  a `PROJECTS` array of `{ id, name, description, format, slides[] }`. It is
  NOT auto-discovered; every new video project must be added there manually:
  import each scene component and add a `Project` entry with one `Slide`
  per scene (id, title, note, component, durationInFrames).
- Note: `video/ai-price-war` and `video/free-ai-builds-intro` were never
  wired into the deck — don't treat their absence there as the pattern to
  follow; `vibe-coding-first-steps` (added in PR #155) is the example to
  copy.
- After wiring it in, verify by running the dev server, opening
  `/presentation`, selecting the new project tab, and confirming the
  Player actually renders/autoplays each scene — don't just rely on
  `tsc --noEmit`. When the dev server is off-limits, the equivalent check is
  `npx remotion still src/remotion/deck-entry.tsx "<project>--<slide>" out.png`
  — same bundle the Download MP4 button uses, so a scene that stills cleanly
  will play in the deck.
- A project directory may back MORE THAN ONE deck entry. `video/broll-collateral`
  is one Remotion project whose ten scenes are grouped into four `PROJECTS`
  entries; share the theme/components rather than copying a project folder per
  deck tab. Deck entries can carry a `group` label, which the picker renders as
  a section heading.

## B-roll for advertising collateral

`video/broll-collateral/` is the library of 5-second product-footage clips
(see its README). Two rules hold it together:

- **The product screenshots are drawn, not captured.**
  `src/components/AppWindow.tsx` renders the app's own chrome, sidebar groups,
  and screen bodies as components. When the real nav or palette changes, update
  that file and `video/broll-collateral/src/theme.ts` to match — stale-looking
  footage is the failure mode here, and a captured PNG also goes soft when a
  screen sits close to camera.
- **Every clip is exactly 150 frames and self-fades at both edges**
  (`clipFade` in `src/motion.ts`), so any two cut together without a flash. New
  B-roll clips must keep both properties or they stop being interchangeable.
  Use the helpers in `src/motion.ts` (`enter`, `stagger`, `ramp`, `drift`)
  rather than hand-rolled easings, so the whole library moves as one system.
