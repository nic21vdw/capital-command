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

## Automatic channel ingest (`src/lib/ingest`)

A daily scan reads the YouTube channel and runs each NEW LIVE STREAM through
the whole Stream Pipeline unattended, stopping at "ready to schedule" — it
never publishes. Live streams only by default (`--all` widens it to ordinary
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
