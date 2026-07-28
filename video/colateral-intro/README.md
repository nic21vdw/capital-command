# CoLateral Intro — name-reveal cards

Five intro cards that reveal the **CoLateral** name, for the top (or tail) of a
demo video. All of them sit on the *live product's* brand, pulled directly from
`nic21vdw/CoLateral-AI`:

- the dark stage (`#070c12`) with the hero's purple blooms and dot grid,
- the real wordmark split — **"Co"** near-white `#f7fbff`, **"Lateral"** brand
  purple `#bd93f9`, Inter 850 at `-0.055em`,
- the real hero copy ("The All-in-One Engineering Workspace"),
- and **Beamy**, the app's canvas buddy, ported pixel-for-pixel from
  `src/components/mascot/Beamy.js` — a purple I-beam in a cream hard hat with the
  purple "C" badge, his four moods and his action poses.

All are **1920×1080 @ 30fps, 6s** (Canvas Spawn is 6.5s).

| Composition | Vibe | What happens |
|---|---|---|
| `RevealDraftingTable` | Calm / premium | The logo mark draws itself on like a CAD line, the eyebrow rises, the wordmark's letters spawn and blur into focus over a hairline rule, and Beamy walks in from the left and waves. |
| `RevealLoadPath` | Structural / signature | A simply-supported beam spans the frame. Point loads drop on, it deflects, the bending-moment diagram traces underneath — then it snaps straight, the diagram collapses, and the wordmark resolves. Beamy rides the deflection with a magnifying glass, then approves. |
| `RevealBeamyEntrance` | Playful | Beamy drops in and dances a four-beat 8-bit loop — step, step, hop, spin — while the letters spawn one per half-beat, on his rhythm. He lands the last beat with sparkles and a wink. |
| `RevealCanvasSpawn` | Product-led | Real tool cards (`Quick Beam`, `Climatic Data`, `Steel Beam Designer`…) spawn across the Project Canvas and wire themselves together, then converge into the centre and resolve as the wordmark. |
| `RevealTypeset` | Minimal / corporate | The live hero, animated: logo, eyebrow, wordmark, tagline, trustline, in the site's own entrance order. The letters spawn spread wide and draw into true kerning. Beamy is perched beside the mark on his slow hover, exactly as on the homepage. |

**Which one to use when** — and how to talk about CoLateral around them — is in
[`docs/colateral-messaging.md`](../../docs/colateral-messaging.md).

## Preview / render

```bash
cd video/colateral-intro
npm install
npm run preview          # Remotion Studio — scrub all five

npm run render:all       # all five → out/*.mp4
npm run render:typeset   # → out/colateral-typeset.mp4
```

All five are also wired into the in-app **Segment Deck** (`/presentation`,
project "CoLateral Intro") via `src/app/presentation/projects.tsx`, so they can
be previewed and exported to MP4 from the dashboard.

## Structure

```
src/
  Root.tsx                       # registers all five compositions
  theme.ts                       # brand tokens + hero copy, lifted from the live site
  components/
    Beamy.tsx                    # the mascot, pixel-for-pixel from Beamy.js
    Wordmark.tsx                 # "CoLateral" — per-letter reveal hook
    HeroMark.tsx                 # the I-beam logo glyph, with a draw-on animation
    Backdrop.tsx                 # dark stage + purple blooms + dot grid
    Type.tsx                     # Eyebrow / Tagline / Trustline
  scenes/
    RevealDraftingTable.tsx
    RevealLoadPath.tsx
    RevealBeamyEntrance.tsx
    RevealCanvasSpawn.tsx
    RevealTypeset.tsx
```

### Notes for future edits

- `Beamy.tsx` is a **port**, not an original. If the mascot changes in the
  product, re-port it from `CoLateral-AI/src/components/mascot/Beamy.js` — the
  design grid is 32×34 and the pixel coordinates map 1:1.
- Copy lives in `theme.ts` (`copy.eyebrow` / `copy.tagline` / `copy.trustline`)
  and is quoted from the hero markup. Change it there, not in the scenes, so all
  five stay consistent with the site.
- `RevealBeamyEntrance` is beat-locked: `BEAT = 15` frames (120 BPM). Letters
  land on half-beats. Change `BEAT` and the whole scene retimes together.
