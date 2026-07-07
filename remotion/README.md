# Capital Command — Manifesto Video (Remotion)

> **"We're not building a business. We're building an empire."**
> A Dracula-themed, 14-slide animated manifesto on embracing AI, built to be
> exported slide-by-slide and narrated live over a PowerPoint slideshow.

This is a **self-contained Remotion project** that lives alongside the main
Next.js app but has its own `package.json` and toolchain. It does not touch the
Capital Command app.

---

## Quick start

```bash
cd remotion
npm install
npm run studio      # opens the Remotion preview at http://localhost:3000
```

In the studio's left sidebar you'll see every slide as its own composition
(`Slide01Hook` … `Slide14Close`) plus the stitched `FullVideo`.

---

## Rendering

### One-command PowerPoint (recommended)

```bash
npm run pptx
```

This renders all 14 slide clips into `./ppt` and assembles
**`ppt/Capital-Command-Manifesto.pptx`** — a 16:9 deck where each slide holds a
full-screen clip **set to auto-play the moment the slide appears**, with a fade
transition between slides. Present it, talk over each slide, and click to
advance; the next slide's clip starts itself. No manual video insertion.

> Needs Python 3 with `python-pptx` for the assembly step:
> `pip install python-pptx`. The render step needs the usual Remotion Chromium
> (auto-downloaded on first run). On a locked-down box you can point Remotion at
> an existing browser with `REMOTION_BROWSER=/path/to/chrome npm run pptx`.

### Slide-by-slide MP4s (if you'd rather build the deck yourself)

```bash
npm run render:all
```

Writes one MP4 per slide into `./out`, named so they sort correctly
(`slide-01-hook.mp4` … `slide-14-close.mp4`, plus `full-video.mp4`). Drop each
onto its own slide (Insert → Video → This Device), set **Play: Automatically**,
and advance manually as you commentate.

### Single slides / full video

```bash
npm run render:slide1     # out/slide-01-hook.mp4
npm run render:slide2     # out/slide-02-split.mp4
npm run render:full       # out/full-video.mp4  (all 14 stitched, cross-dissolved)

# or any composition by id:
npx remotion render Slide11Colateral out/colateral.mp4
```

### PNG stills (if you'd rather use static images)

```bash
npx remotion still Slide14Close out/close.png --frame=200
```

---

## Editing the copy

**All wording lives in one file:** [`src/data/script.ts`](src/data/script.ts).

Each slide has a `headline` (what appears on screen), a `kicker` (small label),
and a `narration` (your teleprompter script — the exact words to speak). Change
text there and the animations pick it up automatically. Use `\n` in a headline
to force a line break, and wrap a word in `*asterisks*` to render it in the
slide's accent color with extra glow.

## Retiming

Every slide's length lives in `DURATION_SECONDS` in
[`src/config.ts`](src/config.ts). Change a number, the whole timeline (and the
stitched `FullVideo`) retimes — no component code to touch.

## Recoloring

Every color is a token in `COLORS` in `src/config.ts` (the Dracula palette).
No component hardcodes a hex, so swapping the theme is a one-file change.

| Token | Hex | Use |
| --- | --- | --- |
| `background` | `#282A36` | base for every slide |
| `panel` | `#44475A` | cards, fills |
| `foreground` | `#F8F8F2` | primary text |
| `muted` | `#6272A4` | the "resistance" cold side |
| `accent` | `#BD93F9` | hero purple — nodes, key text |
| `accentAlt` | `#FF79C6` | pink — impact text, highlights |
| `line` | `#8BE9FD` | cyan connecting lines |
| `growth` | `#50FA7B` | green "growth" pop |

---

## Project structure

```
remotion/
├── package.json          self-contained deps + render scripts
├── remotion.config.ts    render quality / codec settings
├── scripts/render-all.mjs
└── src/
    ├── index.ts          registers the root
    ├── Root.tsx          one <Composition> per slide + FullVideo
    ├── FullVideo.tsx     stitches all slides with cross-dissolves
    ├── config.ts         ★ colors, timing, video dims (edit here)
    ├── fonts.ts          Inter via @remotion/google-fonts
    ├── data/script.ts    ★ all headlines + narration (edit here)
    ├── components/
    │   ├── Background.tsx      dark base + vignette + accent bloom
    │   ├── NodeField.tsx       drifting glowing network
    │   ├── SplitScreen.tsx     resistance vs. future visual
    │   ├── GlowText.tsx        base type primitive + Kicker
    │   ├── TypeOnText.tsx      typewriter + GlitchSwap
    │   ├── ImpactText.tsx      slam-in headline with shake
    │   ├── SlideChrome.tsx     act label + brand + slide number
    │   └── ManifestoSlide.tsx  reusable text-forward slide
    └── slides/
        ├── Slide01Hook.tsx        1995 → 2026 glitch
        ├── Slide02Split.tsx       resistance vs. future
        ├── Slide04Reframe.tsx     "IT REWRITES IT." slam
        ├── Slide05Internet.tsx    jobs-that-didn't-exist network
        ├── Slide11Colateral.tsx   product one + "Built on Fable 5" badge
        ├── Slide14Close.tsx       empire slam + brand resolve
        ├── Slide03…13*.tsx        ManifestoSlide wrappers
        └── registry.ts            ordered slide manifest
```

`★` = the two files you'll actually edit to change words or timing.

---

## The narration (speaker script)

The full spoken script is in `src/data/script.ts` under each slide's
`narration` field. Read it straight through and it's a ~4–5 minute talk.
Recommended delivery: keep the first 4 seconds of Slide 01 **quiet and slow** —
the silence before the year swaps is what makes the build hit.

## Notes

- 1920×1080, 30fps, H.264, CRF 16 (high quality). Tweak in `remotion.config.ts`.
- The "90% hate AI" / "booed off the stage" lines are framed as *felt
  observation* ("it feels like…"), not stated statistics — keep them that way
  so nobody fact-checks you in the comments.
- Fonts are bundled via `@remotion/google-fonts`, so renders are deterministic
  and need no network at render time.
```
