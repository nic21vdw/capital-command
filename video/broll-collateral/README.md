# B-Roll Library — advertising collateral

Ten interchangeable **5-second** clips (150 frames @ 30fps) of CoLateral Command
in motion, for cutting under voiceover, behind ad copy, or between talking-head
segments. Everything moves on iOS motion curves — springs for entrances, the
UIKit deceleration curve for everything else, and no linear ramps anywhere.

## The clips

| Clip | Format | What it is |
| --- | --- | --- |
| `FloatingScreens` | 16:9 | Five app screens hang at different depths and drift; hero sharp in the middle |
| `CardShuffle` | 16:9 | iOS app-switcher fan-out, hold, and settle back into the deck |
| `DepthDolly` | 16:9 | Lateral camera glide past a wall of screens, real perspective parallax |
| `PipelineFlow` | 16:9 | Stream Pipeline presents like a sheet, output formats fly out as glass pills |
| `ClipGridPop` | 16:9 | Finished 9:16 shorts lift out of the Clip Generator toward camera |
| `CalendarFill` | 16:9 | A month fills in, then an iOS sheet confirms 72 posts across 4 channels |
| `GlassMetrics` | 16:9 | Frosted claim tiles count up over out-of-focus product footage |
| `WordmarkAmbient` | 16:9 | CoLateral resolves out of a blur — "One stream in. Every format out." |
| `PhoneShowcase` | 9:16 | An iPhone pages the shorts feed with real iOS paging springs |
| `VerticalStack` | 9:16 | A column of screens climbs the frame, sharp only in the middle band |

Every clip fades in and out at its own edges (`clipFade` in `src/motion.ts`), so
any two butt-cut together without a flash, and the drift periods divide 150
frames so the loopable ones actually loop.

## The screenshots are drawn, not captured

`src/components/AppWindow.tsx` renders the product UI as components — window
chrome, the real sidebar groups (Plan / Create / Distribute), and six screen
bodies (`pipeline`, `clips`, `calendar`, `analytics`, `editor`, `ideas`). A
captured PNG would be stale the next time the UI changes and would go soft when
a screen sits close to camera; drawn screens stay crisp at any scale and can
animate their own contents (`progress` drives the bars filling, rows landing,
playhead moving).

If you change the app's nav or palette, update `AppWindow.tsx` and `theme.ts` to
match — the whole point is that this footage looks like the real product.

## Where these are used

The scenes are wired into the app's **Segment Deck** at `/presentation`, split
across four project entries — `B-Roll · Floating UI`, `· Product Tour`,
`· Vertical Cuts`, `· Brand Atmos` — in `src/app/presentation/projects.tsx`.
That is where you preview them and download MP4s day to day.

For a standalone Remotion Studio session in this folder:

```bash
npm install
npm run preview          # studio
npm run render:all       # all ten to out/
```
