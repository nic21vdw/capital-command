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
