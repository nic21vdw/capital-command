# CoLateral Intro — B-roll

Reusable intro B-roll for introducing **CoLateral**. The title reveals itself
on a clean **white** background in the CoLateral brand: **"Co"** reads
near-black navy, **"Lateral"** the vivid brand **blue**. Alongside it, **Beam
Buddy** — CoLateral's mascot, an 8-bit pixel-art structural I-beam wearing a
white hard hat — pops, hops, waves and (sometimes) speaks.

Five iterations (pick per video, or cut between them):

| Composition            | Vibe                | What happens |
|------------------------|---------------------|--------------|
| `IntroAssemble`        | Calm / premium      | Beam Buddy drops in and lands with a squash on a faint blueprint grid; a structural beam draws in; the `CoLateral` wordmark settles onto it letter by letter; Buddy waves. |
| `IntroBeamSweep`       | Playful / energetic | Beam Buddy pops into centre with pulse rings, steps left, and fires a light beam that wipes the `CoLateral` wordmark into view left-to-right. |
| `IntroBlueprintBuild`  | Layered / premium   | On a blueprint grid, the kicker eyebrow fades in, Buddy hops in, the wordmark snaps together as dropped blocks above the product one-liner; Buddy waves. |
| `IntroBeamGreeting`    | Playful             | The beam-sweep reveal, then Buddy pipes up with a speech bubble — "I'm reinforced by all your good vibes." |
| `IntroPixelType`       | Retro / techy       | The wordmark types itself out behind a blinking blue block caret over faint CRT scanlines, with an 8-bit kicker below; Buddy nods along. |

All are **1920×1080 @ 30fps, 5s (150 frames)** — landscape B-roll you can drop
behind or beside a talking-head intro.

## Preview / render

```bash
cd video/colateral-intro
npm install
npm run preview            # Remotion Studio — scrub all comps

npm run render:assemble    # → out/colateral-intro-assemble.mp4
npm run render:beam        # → out/colateral-intro-beam-sweep.mp4
```

All scenes are also wired into the in-app **Segment Deck** (`/presentation`,
project "CoLateral Intro") via `src/app/presentation/projects.tsx`, so they can
be previewed and exported to MP4 from the dashboard too.

## Structure

```
src/
  Root.tsx                    # registers all five intro comps
  theme.ts                    # white stage + CoLateral blue palette
  components/
    BeamBuddy.tsx             # the mascot (8-bit I-beam in a hard hat)
    Wordmark.tsx              # "CoLateral" ("Co" ink · "Lateral" blue)
    BlueprintGrid.tsx         # faint structural grid background
    Kicker.tsx               # small-caps brand eyebrow label
    SpeechBubble.tsx         # Buddy's rounded speech bubble
  scenes/
    IntroAssemble.tsx         # iteration A
    IntroBeamSweep.tsx        # iteration B
    IntroBlueprintBuild.tsx   # iteration C
    IntroBeamGreeting.tsx     # iteration D
    IntroPixelType.tsx        # iteration E
```
