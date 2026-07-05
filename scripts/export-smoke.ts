/**
 * Headless smoke test for the clip export pipeline. Builds a synthetic base
 * clip, runs a full export (reframe + caption burn-in + text overlay + audio
 * fades + reframe to a new aspect ratio), then probes the output to prove it is
 * a real, playable video. Run with: npx tsx scripts/export-smoke.ts
 */
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg, probeDuration } from "@/lib/clipping/ffmpeg";
import { outputDir, workDir } from "@/lib/clipping/jobs";
import { getExport, startExport } from "@/lib/clipping/export";
import { defaultCaptionStyle } from "@/lib/storage/schemas";
import type { CaptionSegment, Overlay } from "@/types/domain";

const jobId = "smoketest";

async function main() {
  await mkdir(outputDir(jobId), { recursive: true });
  await mkdir(workDir(jobId), { recursive: true });

  // 1. Synthetic 9:16 base clip: 3s of testsrc video + a sine tone.
  const basePath = path.join(outputDir(jobId), "clip-base.mp4");
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=1080x1920:rate=30:duration=3",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    basePath
  ]);
  console.log("base clip created:", basePath);

  const captions: CaptionSegment[] = [
    {
      id: "c1",
      start: 0,
      end: 1.5,
      text: "Hello world",
      words: [
        { text: "Hello", start: 0, end: 0.7 },
        { text: "world", start: 0.7, end: 1.5 }
      ],
      enabled: true
    },
    {
      id: "c2",
      start: 1.5,
      end: 3,
      text: "Export works",
      words: [
        { text: "Export", start: 1.5, end: 2.2 },
        { text: "works", start: 2.2, end: 3 }
      ],
      enabled: true
    }
  ];

  const overlays: Overlay[] = [
    {
      id: "o1",
      kind: "text",
      text: "SMOKE TEST",
      x: 0.5,
      y: 0.2,
      scale: 1,
      rotation: -4,
      opacity: 0.9,
      z: 1,
      locked: false,
      start: 0,
      end: 3,
      color: "#ffd34d",
      fontWeight: 800
    }
  ];

  // 2. Export, reframing 9:16 -> 1:1 with karaoke highlight + audio fades.
  const record = startExport({
    jobId,
    sourceFile: "clip-base.mp4",
    baseDurationSec: 3,
    trimStart: 0,
    trimEnd: 3,
    compositionMode: "center-blur",
    reframe: { scale: 1, offsetX: 0, offsetY: 0 },
    captions,
    captionStyle: { ...defaultCaptionStyle, animation: "karaoke" },
    captionsVisible: true,
    highlightCurrentWord: true,
    overlays,
    audio: { clipVolume: 1, fadeIn: 0.5, fadeOut: 0.5, musicVolume: 0.5 },
    settings: {
      preset: "square",
      width: 1080,
      height: 1080,
      fps: 30,
      quality: "medium",
      format: "mp4",
      burnCaptions: true,
      separateSubtitle: false,
      watermark: false,
      filename: "smoke"
    }
  });

  // 3. Poll until done.
  const start = Date.now();
  while (Date.now() - start < 120000) {
    const cur = getExport(record.id);
    if (!cur) throw new Error("export record vanished");
    if (cur.status === "done") {
      const outPath = path.join(outputDir(jobId), cur.file as string);
      const info = await stat(outPath);
      const dur = await probeDuration(outPath);
      console.log(`EXPORT OK -> ${outPath} (${(info.size / 1024).toFixed(0)} KB, ${dur.toFixed(2)}s, ${cur.width}x${cur.height})`);
      await rm(path.join(process.cwd(), "data", "clips", "outputs", jobId), { recursive: true, force: true });
      await rm(path.join(process.cwd(), "data", "clips", "uploads", jobId), { recursive: true, force: true });
      return;
    }
    if (cur.status === "error") throw new Error("export failed: " + cur.error);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("export timed out");
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e);
  process.exit(1);
});
