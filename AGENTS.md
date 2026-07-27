# capital-command

**This file is the single source of truth for agent instructions in this repo.**
Claude Code, Codex, and any other coding agent should read it. `CLAUDE.md` is a
pointer to this file. When a rule changes, change it here and nowhere else.

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
  `tsc --noEmit`.
