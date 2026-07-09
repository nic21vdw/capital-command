# Free AI Builds — Signal graphics

Remotion insert graphics for the **Free AI Builds** YouTube series. Vertical
**1080×1920 @ 30fps**. These are overlay/insert clips dropped onto a timeline
that is mostly direct-to-camera footage — they are **not** meant to play
back-to-back as one continuous video.

## Run it

From inside this folder (`signal-free-ai-builds/`):

```bash
npm install            # first time only (or reuse the repo-root install)
npx remotion preview   # opens Remotion Studio with every composition
```

`npx remotion preview` auto-detects the entry point `src/index.ts`.

## Compositions

| Composition ID | Frames | What it is |
|---|---|---|
| `FreeAIBuilds`  | 620 | The full preview timeline — all scenes spaced out with gaps |
| `ColdOpenTitle` | 90  | Scene 1 · 3s title reveal |
| `SeriesLogo`    | 60  | Scene 2 · 2s logo card (props: `title`, `accent`) |
| `LowerThird`    | 100 | Reusable name/title card (props: `name`, `subtitle`) |
| `CommentCTA`    | 120 | Scene 4 · 4s comment call-to-action |
| `EndCard`       | 90  | Scene 5 · 3s end card |

## The "Signal" palette

All colours live in **`src/theme.ts`** as named constants — nothing is
hardcoded per component, so you can reskin the whole series in one place:

| Constant | Value | Use |
|---|---|---|
| `COLOR_BG` | `#0f0f0f` | Near-black background |
| `COLOR_PRIMARY` | `#FF4B1F` | Orange-red — primary accent |
| `COLOR_SECONDARY` | `#FFD23F` | Yellow — highlights / CTAs **only** |
| `COLOR_TEXT` | `#FAFAFA` | Off-white text |
| `COLOR_REVEAL` | `#3DDC84` | Green — **reserved** for reveal/payoff moments only (intentionally unused in these launch scenes) |
| `COLOR_MUTED` | `#9AA0A6` | Muted gray — subtitles |

## Repositioning scenes to match your live-footage edit

Every scene is wrapped in its own `<Sequence>` in **`src/Video.tsx`**, and all
start frames live in one `TIMELINE` object at the top of that file:

```ts
export const TIMELINE = {
  coldOpen:    { from: 0,   durationInFrames: 90 },
  seriesLogo:  { from: 110, durationInFrames: 60 },
  lowerThirdA: { from: 190, durationInFrames: 100 },
  lowerThirdB: { from: 305, durationInFrames: 100 },
  commentCta:  { from: 410, durationInFrames: 120 },
  endCard:     { from: 530, durationInFrames: 90 },
};
```

- **`from`** = the frame the insert appears at. Change it to line the graphic up
  with the moment in your footage (frame = seconds × 30).
- **`durationInFrames`** = how long it stays on screen. Entrance/exit animations
  (e.g. `LowerThird`, `SeriesLogo`) key off this automatically, so they always
  slide out cleanly no matter the length.
- Sequences are independent — they can overlap, sit far apart, or be dropped
  entirely. If you extend the timeline past 620 frames, bump `TOTAL_FRAMES` in
  `src/Video.tsx`.

Because the graphics you actually composite are the **individual scene
renders** (below), `Video.tsx` is really just a preview harness — reposition
freely without worrying about the final export.

## Rendering individual scenes for compositing

Each scene is registered as its own composition, so you can render just the
insert you need and drop it into Premiere / Resolve / Final Cut:

```bash
# opaque MP4 (renders on the #0f0f0f Signal background)
npx remotion render ColdOpenTitle out/cold-open.mp4
npx remotion render CommentCTA    out/comment-cta.mp4

# LowerThird / SeriesLogo take props — override via --props
npx remotion render LowerThird out/lower-nic.mp4 \
  --props='{"name":"Nic Vandewetering","subtitle":"Structural Engineer, Building CoLateral"}'

npx remotion render SeriesLogo out/logo.mp4 --props='{"title":"FREE AI BUILDS"}'
```

### Transparent overlays (alpha)

For a graphic you want to key over footage (e.g. the lower third with no
background box behind it), render with an alpha-capable codec:

```bash
# ProRes 4444 with alpha
npx remotion render LowerThird out/lower-third.mov --codec=prores --prores-profile=4444

# or WebM/VP8 with alpha
npx remotion render LowerThird out/lower-third.webm --codec=vp8 --image-format=png
```

Then remove the `Stage` background wrapper for that scene in `src/Root.tsx` (or
render the component with a transparent composition) so only the graphic keys
through.

## Reusing components in future episodes

`LowerThird` and `SeriesLogo` are standalone and fully prop-driven — import them
into any future episode project and pass new text:

```tsx
<LowerThird name="Guest Name" subtitle="Their Title Here" />
<SeriesLogo title="FREE AI BUILDS" />
```

`src/Video.tsx` shows two `LowerThird` instances with different props as a live
example.
