# CoLateral Intro — B-roll

Reusable intro B-roll for introducing **CoLateral**. The title reveals itself
on a clean **white** background while **Beam Buddy** — CoLateral's mascot, a
friendly structural I-beam in the brand purple — appears alongside it.

Two iterations (pick per video, or cut between them):

| Composition       | Vibe               | What happens |
|-------------------|--------------------|--------------|
| `IntroAssemble`   | Calm / premium     | Beam Buddy drops in and lands with a squash on a faint blueprint grid; a purple structural beam draws in; the `CoLateral` wordmark settles onto it letter by letter; Buddy waves. |
| `IntroBeamSweep`  | Playful / energetic| Beam Buddy pops into centre with pulse rings, steps left, and fires a light beam that wipes the `CoLateral` wordmark into view left-to-right. |

Both are **1920×1080 @ 30fps, 5s (150 frames)** — landscape B-roll you can drop
behind or beside a talking-head intro. The capitals **C** and **L** carry the
brand purple to reinforce the `CoLateral` capitalisation.

## Preview / render

```bash
cd video/colateral-intro
npm install
npm run preview            # Remotion Studio — scrub both comps

npm run render:assemble    # → out/colateral-intro-assemble.mp4
npm run render:beam        # → out/colateral-intro-beam-sweep.mp4
```

Both scenes are also wired into the in-app **Segment Deck** (`/presentation`,
project "CoLateral Intro") via `src/app/presentation/projects.tsx`, so they can
be previewed and exported to MP4 from the dashboard too.

## Structure

```
src/
  Root.tsx                    # registers IntroAssemble + IntroBeamSweep
  theme.ts                    # white stage + brand purple palette
  components/
    BeamBuddy.tsx             # the mascot (self-animating I-beam character)
    Wordmark.tsx              # "CoLateral" wordmark (brand-coloured capitals)
    BlueprintGrid.tsx         # faint structural grid background
  scenes/
    IntroAssemble.tsx         # iteration 1
    IntroBeamSweep.tsx        # iteration 2
```
