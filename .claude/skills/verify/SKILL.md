---
name: verify
description: Build, launch, and drive Capital Command to verify a change end-to-end in the running app.
---

# Verifying changes in Capital Command

Next.js app. `npm install --ignore-scripts` is enough for dev (the only
postinstall is ffmpeg-static's binary download, which fails behind a proxy and
is only needed for actual clip rendering/export).

## Launch

```bash
npm run dev   # ready in ~2s on http://localhost:3000
```

Routes: `/clips` (clip generator), `/editor` (clip editor), `/` (dashboard).
`/thumbnails` and `/youtube` currently redirect to `/clips` — the thumbnail
generator component exists but is not mounted on any route.

## Drive the UI

Playwright with the pre-installed Chromium:
`executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"`
(check the exact `chromium-*` dir under `/opt/pw-browsers/`).

## Getting a project into the Clip Editor without running the pipeline

The editor needs (a) a job in `data/clips/jobs.json` and (b) a video file it
can serve. The files API only serves filenames listed in the job's `clips`.

1. Generate a small video in the browser (canvas `captureStream` +
   `MediaRecorder`, `video/webm;codecs=vp8`) — the bundled Playwright ffmpeg
   has no `lavfi`, so it can't synthesize test video. Write it to
   `data/clips/outputs/<jobId>/clip.webm`.
2. Write `data/clips/jobs.json`: an array with one job
   `{ id, fileName, sourceUrl, status: "done", stage: "finished", progress: 100,
   notices: [], createdAt, clips: [{ id, start, end, score, breakdown: {hook,
   pacing, standalone, intensity}, rationale, file: "clip.webm" }] }`.
3. **Restart the dev server** — jobs are cached on `globalThis` after first load.
4. Seed a draft project in the browser:
   `localStorage.setItem("capital-command:clip-editor-draft:<id>", JSON.stringify(project))`
   then navigate to `/editor?open=<id>`. The project must be a full
   `ClipProject` (see `src/lib/storage/schemas.ts` `clipProjectSchema` for the
   shape; the draft path is plain `JSON.parse`, no schema defaults).
5. Wait for `[data-preview-frame]`. If the preview shows "This clip's video
   isn't available", the files API returned non-200 (job missing / filename not
   listed / file absent).

Clean up `data/clips/` test fixtures afterwards.
