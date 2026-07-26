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
