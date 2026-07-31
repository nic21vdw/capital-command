# capital-command

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

A run started by hand passes TWO GATES, because the expensive half of the
pipeline is the encoding and nobody should wait for a render they were never
going to keep:

1. **The plan** (`status: "planning"`, `src/lib/pipeline/plan.ts`). Nothing is
   downloaded until it is approved. The plan says what the run will produce and
   how much of it — clip count, slide count, which feeds get posts, whether the
   long-form edit and MP3 are rendered at all — and every stage reads it
   afterwards (`runPlan`). `plannedOutputs` writes the summary the page shows,
   so the promise on screen and the work the server does come from one function.
2. **The review** (`outputsApprovedAt`). Everything the run DECIDED from the
   transcript — topic segments, clip moments with titles, slide headings, post
   copy — is written and put up for editing before a frame is encoded. The clip
   job holds itself at `stage: "review"` (`reviewGate` on the job, released by
   `approveClipRenders`), and the long-form export does not start. Titles are
   editable and anything can be dropped, through `PATCH /api/pipeline/<runId>`.

Both gates are skipped by `autoApprove`, which ONLY the channel scan sets —
a gated unattended run would sit at the first gate until its wait timed out.
Analysis (transcription, moment selection, topic splitting, the carousel and
post copy) all happens BEFORE the second gate on purpose: that is what makes
the review worth reading, and it is cheap next to the renders.

- When a NEW output format is added to the app, wire it into the pipeline:
  a stage in `runs.ts` (+ `types.ts`), a row in
  `src/components/pipeline/pipeline-page.tsx`, and a count in the
  scheduler-stage summary. Give it a line in `plannedOutputs` too, and hold its
  RENDER (never its analysis) behind `rendersApproved`.
- Pipeline runs are owned by ONE process: a `globalThis` Map flushed to
  `data/pipeline/runs.json`. Anything outside the Next server that wants to
  start or advance a run must go through the HTTP API (`POST /api/pipeline`,
  `GET /api/pipeline`) — see `src/lib/ingest/pipelineClient.ts`. Importing
  `@/lib/pipeline/runs` from a separate process (a CLI, a scheduled task)
  gives it a second copy of that Map and the two clobber each other's
  `runs.json`.

## Automatic channel ingest (`src/lib/ingest`)

A daily scan reads the YouTube channel and runs each NEW LIVE STREAM through
the whole Stream Pipeline unattended, stopping at "ready to schedule" — it
never publishes. Live streams only by default (`--all` widens it to ordinary
long-form uploads). Two guards stop it re-ingesting the app's own output:
exact provenance (`platforms.youtube.postId` in the publish queue) and a
Shorts shape heuristic. The ledger (`data/channel-ingest.json`) records what
has been taken in; only a SETTLED pipeline run counts as done, so a timeout
is retried rather than lost. See `src/lib/ingest/README.md`.

## Revising a scheduled post (`src/lib/publisher/revise.ts`)

The publish queue can be changed after the fact — time, caption, hashtags,
visibility, account, platform targets — plus skip (terminal, keeps the record)
and a whole-day shift. All of it goes through `revise.ts`, which is PURE: the
API routes are thin shells over it, so the rules are tested without a queue, a
network or a clock.

- The one hard rule is `lockedPlatforms`: once a platform has the post
  (`uploaded` / `scheduled` / `published`) it can only be RENAMED, because
  YouTube's `videos.update` genuinely renames a live video and nothing else
  local can reach the platform's copy. `failed`, `pending`, `manual` and
  `skipped` are still ours. A refusal is a 409 with a sentence a creator can
  act on, never a bare status code.
- `skipped` is a terminal `PlatformStatus` — add it to any exhaustive switch.
  It exists so stopping a post doesn't mean deleting it and losing the clip
  and the copy with it.
- Moving a post CLEARS `nextAttemptAt` and `claimedAt` (`withoutGates`), or the
  runner keeps honouring backoff gates set for the schedule it no longer has.
  Same reason the Threads autopilot does it in `rescheduleItem`.
- `AgendaDay.past` means "no slots left to schedule into", NOT "nothing left to
  move" — a 21:45 post sits on a day with no open slots and is still movable.
  Use `isMovable` for anything about moving; it is shared with the UI so the
  "Shift day" control appears exactly when the shift would do something.
- A day shift reports what it could NOT move (`blocked`) rather than passing
  over it in silence — "moved 4, left 2 alone" is the honest answer.

## Channel Hub (`/channels/<network>`, `src/lib/channels`)

One screen per connected network — YouTube, Instagram, TikTok, Facebook,
Threads — showing everything already scheduled to go out there: short clips,
long-form videos, carousels and text posts on one calendar. Opened by clicking
that network's logo in the sidebar.

- It owns no storage. Every event is a `MasterCalendarEvent` from
  `buildMasterCalendarEvents`, narrowed to one network. Rescheduling and
  rewriting happen in place (see Calendar editing below) but always by calling
  the owning system's API — the hub never touches a store directly, and
  anything it can't edit links back to where it is managed.
- Matching is by ALIAS, not by a shared enum: events name their networks as
  display strings from several sources (the publish queue's platform labels, a
  carousel schedule's target list, the content tracker's free-text platform
  field), so a new label goes in `CHANNELS[...].aliases`.
- Events group by the SHAPE of the post (short / long-form / carousel / text),
  not by the subsystem that produced it — which subsystem owns it is an
  implementation detail the creator doesn't think in.
- The Threads page prefers the autopilot's real queue over the suggested pack
  on any day the queue has already scheduled (`mergeThreadsEvents`), so it
  shows what will actually post rather than both.
- Threads is not a publish-queue platform, but the sidebar lists it beside the
  other four, so its standing rides along on `/api/publish/accounts` rather
  than costing the app shell a second request. Reading it is pure config
  parsing — no tokens leave the server.

## Calendar editing (`src/lib/master-calendar/editing.ts`)

The Master Calendar and the Channel Hub reschedule in place: drag an event to
another day, or click it to nudge the time, rewrite the copy and skip it.

- The calendar OWNS NOTHING. Every write goes to the system that owns the
  event through the route its own screen uses — `/api/publish/:id` for the
  publish queue, `/api/threads` for the autopilot — so the rules about what may
  change live in one place and a refusal is whatever sentence the server wrote.
- An event is editable only when the aggregator attached `edit`
  (`CalendarEditTarget`), and movable only when that target has no
  `lockedReason`. Carousel schedules, FB/IG drafts and the content tracker have
  no such API yet, so they stay read-only and link out. Adding one means
  attaching `edit` in `aggregate.ts` and a case in `editing.ts` — nothing in
  the calendar components changes.
- A day drop carries the WALL-CLOCK time across, not the elapsed milliseconds,
  so a 19:30 post is still 19:30 on the far side of a DST boundary. That is why
  `movedToDay` goes through `zonedToUtc` instead of adding 86,400,000 ms.
- The Master Calendar now shows the autopilot's REAL queue, not just the
  suggested pack — `buildMasterCalendarEvents` takes `threadsItems` and
  `mergeThreadsEvents` lets the queue win on days it has scheduled. Both
  calendars share that, so they can no longer disagree about a day.

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
- A missed slot is SKIPPED, never fired late, and past slots are never
  scheduled. Preserve that when touching `runner.ts` / `plan.ts`: the whole
  point is that an offline morning can't dump a backlog into the feed.
- A slot is past/future by its OWN time, never the per-account offset, so the
  accounts can never drift out of step at the edges of the day.
- Planning is CHECK, generate (minutes), then APPEND — three steps, not one
  atomic write. The append re-checks that nothing landed on the day meanwhile
  and drops its own batch if it lost the race; without that, two overlapping
  ticks each see an empty day and every slot gets posted twice.
- Never put a token in an API response or a log line — the route exposes only
  each account's id, label, version and offset.
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
and gathers the recording into the 3-5 subjects it actually covered, each
exportable as its own long-form upload. `projectForTopic` in `plan.ts` renders
one by clipping the project's timeline to that segment's ranges and moving the
hook onto its opening, so segments go through the SAME export engine as the full
edit (cuts, captions, overlays, mix) and nothing downstream needs a special
case.

- A segment is GATHERED, not sliced. A stream does not run one, two, three: a
  subject is dropped and picked up again twenty minutes later, so
  `LongformTopic.ranges` holds every stretch that belongs to the subject and the
  export plays them back to back (which is what dead-space cutting already
  does). `start`/`end` are only the outer span for display — the runtime is
  `topicDurationSec`. Topics stored before `ranges` existed read back as the
  single window `[start, end]`.
- The gathering is three passes: lexical-cohesion boundaries (vocabulary
  turnover), a pool of ~2.5 minute pieces with the dead-air ones dropped, then
  agglomerative clustering of those pieces by idf-weighted vocabulary. One
  subject gives ONE upload: where the length cap leaves the same subject in two
  clusters, the one carrying more of it wins and the leftover is dropped rather
  than published as a near-duplicate.
- Topic segments and short-form clips are independent selections over the same
  transcript, and must stay that way: the Clip Generator scans the whole stream
  for its best 30-second moments wherever they fall; topic segments gather the
  stream into whole subjects. Neither constrains the other.
- Topics need a transcript of the WHOLE recording. Long-form analysis only
  transcribes the opening of a long source (that is all the hook needs), so
  `planProjectTopics` falls back to the full transcript the clip job made from
  the same `sourceId`; the pipeline plans the segments once that lands.
- Segments are planned automatically but rendered on demand — auto-rendering
  five ten-minute videos per stream is hours of encoding nobody asked for.

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

## Clip ranges: the suggestion is editable, in SOURCE time

A clip candidate is a range in the stream, not a file — `ClipCandidate.start` /
`.end` are absolute source seconds and everything rendered is derived from them.
So the Clip Generator shows each clip's place in the whole recording
(`StreamMap`) and lets the range be moved anywhere in it (`ClipRangeEditor` →
`recutClip` in `jobs.ts` → `POST /api/clips/<job>/recut`), which just points
`renderClipIndexes` at new times.

- TWO coordinate systems, never mixed. `src/lib/clipping/timeline.ts` is
  absolute SOURCE seconds (where a clip sits in the stream);
  `src/lib/clipping/segments.ts` and the Clip Editor's timeline are
  CLIP-RELATIVE (0 = first frame of the rendered master). `windowSegments` is
  the only boundary between them.
- A re-cut REWRITES the clip's files under their existing names, and those are
  served with a long private cache — so every URL pointing at a clip file
  carries `?v=<clip.recutAt>` or the browser keeps painting the previous cut.
  Any new surface that links a clip file must do the same.
- A re-cut also invalidates any Clip Editor project cut from the old range
  (its trim, segments and captions describe footage that no longer exists), so
  a project is only reopened when its `clipStart`/`clipEnd` still match the
  clip; otherwise it is rebuilt.
- `clip.originalRange` records where the automatic selection put the clip the
  first time it moves, so "suggested range" always means the suggestion rather
  than the previous manual cut.
- URL jobs keep only their audio after analysis, so a re-cut there is another
  `downloadSection`; uploads still have the whole file on disk, which is why
  only they get the source scrubber and waveform in the range editor.

## Clip previews: center + blur, always the whole frame

Every surface that shows a clip renders through `ClipFrame`
(`src/components/clips/clip-frame.tsx`), never a bare `<video>`. It reproduces
the center + blur composition `renderCaptionedVertical` burns into the
ready-to-post file: the whole frame `object-contain` over a blurred, dimmed
copy of the same footage.

- NEVER `object-cover` on a clip — it crops footage out of shot, and the point
  of a preview is to show what you are actually shipping.
- NEVER let a clip letterbox onto the card background — black bars are the bug
  this exists to prevent. A tile has to look right whichever file is backing
  it: the finished 9:16 render (`downloadFile`), the instant 16:9 preview
  published before the HD render lands (`previewFile`), or the neutral master
  of an older job whose ready render never happened (`file`).
- Preview boxes are a full `aspect-[9/16]` — the shape the clip posts in — so
  nothing is cut off. Use `aspect="16/9"` only when the subject genuinely is a
  widescreen master (e.g. an editor project's source).

The render side already defaults to center + blur and should stay that way:
`compositionMode` defaults to `"center-blur"` both at project creation
(`editor.ts`) and on load (`schemas.ts`), and the Clip Generator's ready render
goes through `renderCaptionedVertical` unconditionally. `DEFAULT_CLIP_LAYOUT`
in `layouts.ts` is `"restream-stack"`, but that is only a parameter fallback
for the opt-in layout-variant helpers — it is NOT a shipped default, so don't
"fix" it into `center` and change what the variants mean.
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
