---
name: animate-video
description: Turn a video idea or script into animated Remotion segments (title cards, animated bullets, stat counters) and render them to MP4 for Nic to record commentary over. Use when the user has an idea and wants animated visuals instead of static slides.
---

# Animate a video idea into Remotion segments

The goal: Nic hands you an idea or a rough script; you produce one or more
**MP4 segments** he records voice-over on top of, then drops into the
`/longform` or `/editor` timeline. No paid API — you author the code here,
rendering happens locally.

The Remotion project lives in `remotion/`. Three reusable compositions already
exist (`TitleCard`, `BulletReveal`, `StatCounter`). Prefer reusing them via
props before writing new ones.

## Workflow

1. **Break the idea into beats.** A 5-minute talking-head video usually wants:
   one `TitleCard` opener, 2–4 `BulletReveal` sections (one per topic), and a
   `StatCounter` for any number worth landing. Map each beat to a composition.

2. **Pick a theme** matching the app accent: `lime`, `violet`, `ocean`,
   `sunset`, `rose`, or `mono`. Keep one theme per video for consistency.

3. **Estimate duration.** Nic talks over these, so they need to be long enough.
   Rule of thumb at 30fps: ~2.5s per bullet + 2s intro. Set `durationInFrames`
   in the props (seconds × 30) — that drives render length, there is no CLI
   duration flag. For `BulletReveal`, set `stagger` so points appear at his
   speaking pace (45 ≈ 1.5s apart) and make `durationInFrames` long enough to
   cover the last bullet plus a tail (`18 + bullets.length * stagger + 60`).

4. **Render each segment** from inside `remotion/`. Props are JSON:

   ```bash
   cd remotion
   npx remotion render src/index.ts BulletReveal out/02-topic.mp4 \
     --props='{"heading":"Why compounding wins","bullets":["Record once","Reuse everywhere","Improve every cycle"],"stagger":45,"theme":"lime","durationInFrames":210}'
   ```

   - Composition ids: `TitleCard`, `BulletReveal`, `StatCounter`.
   - Every segment's props include `durationInFrames` — always set it.
   - Name files with an order prefix (`01-`, `02-`) so the timeline order is obvious.
   - Output lands in `remotion/out/` (git-ignored).

5. **Report back** the list of rendered files and a one-line suggested
   voice-over cue for each, e.g. `out/01-intro.mp4 — "Today I want to show you…"`.

## One continuous video vs separate clips

Two ways to deliver:

- **Separate clips** (render each composition on its own) — best when Nic will
  drop them onto the editor timeline and position each under the right part of
  his talk. Default for the record-then-edit pipeline.
- **One stitched video** — the `Presentation` composition takes an ordered
  `segments` array (each tagged `type: "title" | "bullets" | "stat"`) and plays
  them back-to-back into a single MP4. Use for a "just hit play and talk over
  it" screen recording. Make each segment's `durationInFrames` generous
  (title ~150, bullets ~540, stat ~300 at 30fps) so a beat holds long enough to
  narrate. Edit the `fable5Ocean` example in `Root.tsx` or pass `--props` with
  your own `segments` array, then `render Presentation`.

## Composition prop shapes

All three also take `durationInFrames` (seconds × 30) — always include it.

- **TitleCard** — `{ title, subtitle, theme, durationInFrames }`
- **BulletReveal** — `{ heading, bullets: string[], stagger, theme, durationInFrames }`
- **StatCounter** — `{ label, value, prefix, suffix, decimals, theme, durationInFrames }`

## When the existing three aren't enough

If the idea needs something new (an animated diagram, a chart, a device
mockup), add a composition:

1. Create `remotion/src/compositions/<Name>.tsx` — a React component driven by
   `useCurrentFrame()`, animating with `spring()` / `interpolate()`. Define a
   `zod` schema and export it (mirror `BulletReveal.tsx`).
2. Register it in `remotion/src/Root.tsx` with a `<Composition>` (1920×1080,
   30fps, `schema` + `defaultProps`). Include a `durationInFrames` field in the
   schema and wire `calculateMetadata={({ props }) => ({ durationInFrames:
   props.durationInFrames })}` so length stays prop-driven like the others.
3. Keep it parameterized via props so it's reusable next time.

## Setup notes (first run on a fresh machine)

- `cd remotion && npm install` once. Rendering needs a Chromium build Remotion
  downloads on first render, plus FFmpeg (bundled with Remotion).
- To preview visually before rendering, `npm run studio` (or double-click
  `launch-remotion-studio.bat`) and scrub the composition with live props.
- Remotion is free for Nic as a solo creator (free for teams ≤ 3 people).

## Handoff to the editors

Rendered MP4s are 1080p H.264, so they import directly. In `/longform` add them
as timeline clips between his talking-head footage; in `/editor` drop them as
overlay/cutaway segments. Trim to taste there.
