# Free AI Builds — Series Intro (Remotion → auto-playing PowerPoint)

A vertical (1080×1920) animated intro for the **Free AI Builds** series, built in
[Remotion](https://www.remotion.dev/) with the **"Signal"** theme (warm
orange-red on near-black), then rendered and embedded into a PowerPoint slide
that **plays automatically the moment you land on it** — no click needed.

## What's here

```
src/
  theme.ts                 "Signal" palette + font stack (single source of truth)
  components/
    GlowBackground.tsx     Looping radial glow pulse (reused across scenes)
    SeriesLogo.tsx         Standalone series bumper — reuse in every episode
    LowerThird.tsx         Reusable name/title card (props: name, subtitle)
    TypewriterText.tsx     Character-by-character reveal with caret
  scenes/
    ColdOpenTitle.tsx      "FREE AI BUILDS" title (0–3s)
    Tagline.tsx            Typed hook lines (3–7s)
    HostCard.tsx           Host intro + LowerThird (7–11s)
    ValueProps.tsx         01 / 02 / 03 value props (11–16s)
    CommentCTA.tsx         "COMMENT BELOW" CTA (16–20s)
    EndCard.tsx            "NEXT: BUILD #1" (20–23s)
  Video.tsx                Continuous 690-frame (23s) assembly
  Root.tsx                 Registers composition FreeAiBuildsIntro (1080×1920, 30fps)
build_pptx.py              Renders the .pptx with autoplay-on-entry
out/
  free-ai-builds-intro.mp4    Rendered video
  free-ai-builds-intro.pptx   PowerPoint with the video autoplaying on slide 2
  poster.png                  Poster frame for the video
```

## The PowerPoint

`out/free-ai-builds-intro.pptx` is a portrait (9:16) deck:

- **Slide 1** — a title lead-in. Its only job is to give you a slide to advance
  *from*, so you can see slide 2's video kick off on entry.
- **Slide 2** — the video, full-bleed. It **starts automatically** when the slide
  appears in Slide Show mode.

### How autoplay works

`python-pptx`'s `add_movie()` only ever wires a video to *play on click*. The
`build_pptx.py` script replaces the slide's `<p:timing>` tree with one whose
media trigger uses `nodeType="afterEffect"` and `<p:cond delay="0"/>` — the exact
shape PowerPoint writes when you choose **Playback ▸ Start ▸ Automatically**. The
video (`.mp4`) and poster (`.png`) are embedded inside the `.pptx`, so the file is
fully self-contained — no external links to break.

> Autoplay fires in **Slide Show mode** (F5 / Present), not in the editing view.
> Works in PowerPoint on Windows and macOS. Keynote and Google Slides import the
> deck but do not honor PowerPoint's autoplay timing — present in PowerPoint.

## Rebuilding from scratch

```bash
npm install

# Preview in the Remotion studio
npm run preview

# 1) Render the video (uses the machine's Chromium headless shell)
npx remotion render FreeAiBuildsIntro out/free-ai-builds-intro.mp4

# 2) Render the poster frame used inside the PPTX
npx remotion still FreeAiBuildsIntro out/poster.png --frame=60

# 3) Build the auto-playing PowerPoint
python3 build_pptx.py        # needs: pip install python-pptx Pillow
```

On a machine without a bundled Chromium, drop the
`--browser-executable=/path/to/headless_shell` flag and Remotion will download its
own. In this repo's build environment it was rendered with the pre-installed
Playwright Chromium.

## Editing the content

- **Colors** live only in `src/theme.ts` — change them once, everywhere updates.
- **Timing** lives in `src/Video.tsx` (each `<Sequence from=… durationInFrames=…>`)
  and `TOTAL_FRAMES`. Keep `Root.tsx`'s `durationInFrames` equal to `TOTAL_FRAMES`.
- **Reusable pieces** (`SeriesLogo`, `LowerThird`) take props so you can drop them
  into future episodes with different text.
- After any content change, re-run the three render/build steps above.
