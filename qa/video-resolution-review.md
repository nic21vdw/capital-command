# Video resolution review - 2026-10-01

Reviewed from `fac8eb3cfa225b2410742c9b2a7707ccdc4d0f86`, in an isolated checkout.

## Findings and resulting behavior

| Path | Finding | Result |
| --- | --- | --- |
| Source acquisition | Source quality had an artificial 2160p download ceiling. | Source requests the best available original, including higher-resolution sources. Explicit lower delivery settings remain ceilings. Adaptive streams are preferred before low-resolution muxed fallbacks. |
| Pipeline loops | A delayed clip stage read the current global quality rather than its run's saved choice. | Each run passes its saved choice into its clip job. Standalone jobs snapshot preferences when created. |
| Shorts | Ready renders and publisher conversion used a fixed 1080 x 1920 canvas. | Sharp foreground, captions, and all three framing layouts use source-derived geometry up to 2160 x 3840. Native HD remains 1080 x 1920; lower selected limits still apply. |
| Neutral clip master | Portrait sources were padded onto a landscape canvas. | Masters retain their source aspect ratio. A portrait master still resolves to its captioned ready file when publishing. |
| Editor handoff | New projects assumed 1920 x 1080 source footage and 30 fps exports. | New clips carry actual master dimensions and source-derived export defaults. Fractional rates such as 59.94 survive schema validation. Legacy clips without metadata retain the existing fallback. |
| Long-form | Source-derived resolution and frame rate were already used. | That behavior remains; removing the source download ceiling allows higher-resolution originals to reach the long-form renderer. |
| Motion segments | Shared in-app exports rasterized 1080p scenes into lossy JPEG frames. | Shared API and root CLI settings rasterize at scale 2 with PNG frames and CRF 17. A 1920 x 1080 authored scene produces 3840 x 2160 output. |

Source footage and crop determine actual detail. A 4K output canvas does not recover pixels missing from an HD recording or a tight crop. The intentionally blurred background is processed at a bounded size; foreground and typography use the full output canvas. Existing high-quality H.264 medium/CRF 17 and AAC 320 kbps/48 kHz/stereo delivery settings remain.

For maximum source retention, use **Source** for resolution and frame rate. Changing the settings does not re-render completed clips, cached delivery files, or old editor projects automatically.

## Verification

- Full TypeScript check: `node node_modules/typescript/bin/tsc --noEmit --incremental false`.
- Focused Vitest regression coverage: 16 files, 162 tests. The Windows sandbox blocks esbuild child-process creation, so `qa/vitest.config.mjs` uses in-process TypeScript transpilation with the real Vitest runner and existing hermetic setup. It does not replace the normal project test configuration.
- Focused ESLint: no errors; existing unused-variable warnings in `editor.ts` and `runs.ts` remain.
- `git diff --check`.
- Actual FFmpeg filter and encoding checks from the application filter builders, with four-frame synthetic 3840 x 2160/59.94 input:

| Check | Probed output | Frame rate | Pixel format/profile |
| --- | --- | --- | --- |
| Captioned center/blur | 2160 x 3840 | 59.94 | yuv420p / H.264 High |
| Subject fill | 2160 x 3840 | 59.94 | yuv420p / H.264 High |
| Camera stack | 2160 x 3840 | 59.94 | yuv420p / H.264 High |
| Explicit 720p/30 limit | 720 x 1280 | 30 | yuv420p / H.264 High |
| Widescreen | 3840 x 2160 | 59.94 | yuv420p / H.264 High |

The captioned preview was visually inspected for placement and readability. These checks do not establish a full live-source-to-platform run. Live downloads, an 8K encode, a Chromium/Remotion render, the full production build, and platform transcoding were not exercised. No production queues, publishing jobs, or installed app files were changed.

## Reproduce

Run the same focused specs using `node node_modules/vitest/vitest.mjs run --config qa/vitest.config.mjs --configLoader native` followed by the clipping encode/download/render/editor/audio/framing/ffmpeg/jobs-retry/jobs-quality/jobs-vertical-quality/export-signature-parity, Remotion export, pipeline outputQuality, longform schemas/story-edit, and publisher vertical test paths.

`qa/plan-media.mjs` requires Node 24's `registerHooks` and generates ignored media plans and ASS captions using the application code. From the repository root, with FFmpeg and ffprobe on PATH:

```powershell
node qa/plan-media.mjs
$qualityCases = Get-Content qa/media-plan.json -Raw | ConvertFrom-Json
foreach ($qualityCase in $qualityCases) {
  $qualityArgs = @($qualityCase.args)
  & ffmpeg @qualityArgs
  if ($LASTEXITCODE -ne 0) { throw "FFmpeg failed: $($qualityCase.name)" }
  & ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,pix_fmt,profile -of json $qualityCase.file
}
```

## Reference guidance

- [YouTube recommended upload encoding settings](https://support.google.com/youtube/answer/1722171?hl=en): retain recording frame rate and use high-quality MP4/H.264 delivery.
- [yt-dlp format selection](https://github.com/yt-dlp/yt-dlp#format-selection): adaptive video/audio selection and fallback ordering.
- [Remotion renderMedia](https://www.remotion.dev/docs/renderer/render-media): render scale and image-format options.
