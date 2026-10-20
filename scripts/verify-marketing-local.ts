/** Explicit synthetic-only runtime check. Never reads production data or calls a publisher. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function main() {
  for (const key of Object.keys(process.env)) {
    if (/^(ANALYTICS_|ANTHROPIC_|APP_BASE_URL|BACKUP_DRIVE_|BUFFER_|CLIPS_|DEEPSEEK_|FAL_|FB_|IG_|META_|OPENAI_|PUBLISH_|R2_|S3_|SPOTIFY_|STRIPE_|THREADS_|TIKTOK_|XAI_|YOUTUBE_)/.test(key)) delete process.env[key];
  }
  const isolated = await mkdtemp(path.join(tmpdir(), "marketing-runtime-synthetic-"));
  process.env.CAPITAL_COMMAND_DATA_DIR = path.join(isolated, "data");
  await mkdir(process.env.CAPITAL_COMMAND_DATA_DIR, { recursive: true });
  const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(isolated, "evidence");
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error("Evidence output must be an empty directory.");
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error("Synthetic runtime check forbids external network."); };
  const { runFfmpeg, probeDimensions, probeDuration } = await import("../src/lib/clipping/ffmpeg");
  const { renderCaptionedVertical, renderPreviewAssets } = await import("../src/lib/clipping/render");
  const { buildAss } = await import("../src/lib/clipping/captions");
  const { defaultCaptionStyle } = await import("../src/lib/storage/schemas");
  const { createYouTubeArtifactReader } = await import("../src/lib/integrations/marketing/artifacts");
  const source = path.join(output, "synthetic-source.mp4");
  const captioned = path.join(output, "synthetic-captioned.mp4");
  const ass = path.join(output, "synthetic-captions.ass");
  const preview = path.join(output, "synthetic-preview.mp4");
  const poster = path.join(output, "synthetic-poster.jpg");
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);
  await writeFile(ass, buildAss([{ id: "synthetic", start: 0, end: 1.5, text: "SYNTHETIC LOCAL TEST", words: [], enabled: true }], defaultCaptionStyle, 360, 640, false));
  await renderCaptionedVertical(source, captioned, ass, true, undefined, 1, 0, { width: 360, height: 640, fps: 24 });
  await renderPreviewAssets(captioned, preview, poster);
  const dimensions = await probeDimensions(captioned);
  const duration = await probeDuration(captioned);
  assert.deepEqual(dimensions, { width: 360, height: 640 });
  assert(duration >= 1 && duration <= 2);
  assert((await stat(poster)).size > 1000);
  const item = {
    id: "synthetic-render-job", clipPath: captioned, title: "Synthetic local runtime", caption: "Generated test footage only.", hashtags: [],
    publishAt: "2099-10-24T12:00:00.000Z", visibility: "private" as const, createdAt: "2026-10-20T00:00:00.000Z",
    platforms: { youtube: { status: "pending" as const, attempts: 0 } }, accountId: "synthetic-account"
  };
  const evidence = await createYouTubeArtifactReader({ projectRoot: output, mediaRoot: output })(item, "youtube");
  assert.equal(evidence.sha256, createHash("sha256").update(await readFile(captioned)).digest("hex"));
  assert.equal(networkCalls, 0);
  const report = {
    fixture: "synthetic generated video and tone; no customer media", passed: true,
    runtime: "existing Node FFmpeg captioned vertical render and preview helpers", dimensions, duration,
    artifactSha256: evidence.sha256, payloadSha256: evidence.payloadSha256,
    networkCalls, publicationAttempted: false, workerTransportConnected: false,
    files: [source, captioned, ass, preview, poster].map((file) => path.basename(file))
  };
  await writeFile(path.join(output, "runtime-check.json"), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({ output, ...report }, null, 2) + "\n");
}
main().catch(() => { process.stderr.write("Synthetic runtime check failed; no publication was attempted.\n"); process.exitCode = 1; });
