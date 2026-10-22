import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { assFilter } from "@/lib/clipping/caption-fonts";
import { buildAss, buildTextOverlayDialogue } from "@/lib/clipping/captions";
import { makeClipProject } from "@/lib/clipping/editor";
import { prepareClipExport, preparationSpecDigest } from "@/lib/clipping/export";
import { renderSignature } from "@/lib/clipping/export-signature";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { editorPreparationSpec } from "@/lib/integrations/marketing/editor-renderer";
import { dataPath } from "@/lib/paths";
import { defaultCaptionStyle } from "@/lib/storage/schemas";
import type { ClipProject, Overlay } from "@/types/domain";

const spies = vi.hoisted(() => ({ attach: vi.fn(), enqueue: vi.fn() }));
vi.mock("@/lib/clipping/jobs", async () => {
  const { dataPath } = await import("@/lib/paths");
  return { outputDir: (id: string) => dataPath("clips", "outputs", id), workDir: (id: string) => dataPath("clips", "uploads", id),
    attachEditedClipRender: spies.attach };
});
vi.mock("@/lib/publisher/enqueue", () => ({ maybeAutoEnqueueExport: spies.enqueue }));
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
let base: ClipProject;
let sourceSha256: string;
beforeAll(async () => {
  vi.stubEnv("PUBLISH_ENABLED", "true"); vi.stubEnv("PUBLISH_AUTO_ENQUEUE", "true");
  base = makeClipProject({ jobId: "overlay-quality", name: "Synthetic overlay", sourceFile: "source.mp4", sourceUrl: "",
    clipStart: 0, clipEnd: 0.6, sourceFrame: { width: 640, height: 360, fps: 10 } });
  base = { ...base, compositionMode: "fit", captionsVisible: false,
    exportSettings: { ...base.exportSettings, width: 640, height: 360, fps: 10 } };
  const source = dataPath("clips", "outputs", base.jobId, base.sourceFile);
  await mkdir(path.dirname(source), { recursive: true });
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=navy:s=640x360:r=10:d=0.6", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
  sourceSha256 = sha(await readFile(source));
}, 30_000);
afterAll(() => vi.unstubAllEnvs());
const overlay: Overlay = { id: "text", kind: "text", text: "WWWW WWWW WWWW WWWW", x: 0.5, y: 0.5, scale: 1,
  rotation: 0, opacity: 1, z: 0, locked: false, start: 0, end: 0.6, color: "#ffffff", fontFamily: "Poppins Black", fontWeight: 800 };
async function render(name: string, change: Partial<Overlay>) {
  const project = { ...base, overlays: [{ ...overlay, ...change }] };
  const spec = editorPreparationSpec(project);
  const binding = { ownerId: "synthetic-overlay-owner", projectId: project.id, jobId: project.jobId, clipId: "original-clip",
    sourceFile: project.sourceFile, sourceSha256, projectDigest: sha(JSON.stringify(project)), specSha256: preparationSpecDigest(spec),
    renderSignature: renderSignature(spec), requestId: randomUUID(), attemptId: randomUUID() };
  const proof = await prepareClipExport(binding, async () => ({ binding, spec }));
  const decoded = path.join(path.dirname(proof.file), "frame.rgb");
  await runFfmpeg(["-y", "-i", proof.file, "-frames:v", "1", "-an", "-f", "rawvideo", "-pix_fmt", "rgb24", decoded]);
  const pixels = await readFile(decoded);
  if (process.env.CLIP_OVERLAY_EVIDENCE === "1") {
    const destination = path.join(process.cwd(), ".test-artifacts", "overlay-export");
    await mkdir(destination, { recursive: true });
    await copyFile(proof.file, path.join(destination, `${name}.mp4`));
    await writeFile(path.join(destination, `${name}.json`), JSON.stringify({ syntheticOnly: true, overlay: project.overlays[0],
      artifactSha256: proof.artifactSha256, decodedSha256: sha(pixels), attached: false, enqueued: false }, null, 2));
  }
  expect(spies.attach).not.toHaveBeenCalled(); expect(spies.enqueue).not.toHaveBeenCalled();
  return pixels;
}
function bounds(pixels: Buffer, accept: (r: number, g: number, b: number) => boolean) {
  let minX = 640, minY = 360, maxX = -1, maxY = -1;
  for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) {
    const offset = (y * 640 + x) * 3;
    if (accept(pixels[offset], pixels[offset + 1], pixels[offset + 2])) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
const white = (r: number, g: number, b: number) => r > 180 && g > 180 && b > 180;

it("real exports respect text box width and preserve wrapping under overlay scale", async () => {
  const narrow = bounds(await render("narrow", { width: 0.3 }), white);
  const wide = bounds(await render("wide", { width: 0.9 }), white);
  const scaled = bounds(await render("scaled", { width: 0.3, scale: 2 }), white);
  expect(narrow.width).toBeLessThanOrEqual(640 * 0.3 + 8);
  expect(narrow.height).toBeGreaterThan(wide.height + 12);
  expect(scaled.width).toBeLessThanOrEqual(640 * 0.3 * 2 + 12);
  expect(scaled.height).toBeGreaterThan(narrow.height * 1.7);
}, 30_000);

it("real exports select the explicit bundled font rather than inheriting caption font", async () => {
  const poppins = await render("poppins", { text: "Overlay WMWM", width: 0.9, fontFamily: "Poppins Black" });
  const anton = await render("anton", { text: "Overlay WMWM", width: 0.9, fontFamily: "Anton" });
  expect(sha(anton)).not.toBe(sha(poppins));
  expect(bounds(anton, white).width).toBeLessThan(bounds(poppins, white).width);
}, 30_000);

it("real exports draw a centered fixed-width background with composed opacity", async () => {
  const solid = await render("background-solid", { text: "BOX", width: 0.5, background: "#ff0000" });
  const red = bounds(solid, (r, g, b) => r > 180 && g < 70 && b < 70);
  expect(red.width).toBeGreaterThanOrEqual(318); expect(red.width).toBeLessThanOrEqual(322);
  expect(red.height).toBeGreaterThanOrEqual(25); expect(red.height).toBeLessThanOrEqual(29);
  expect(Math.abs((red.minX + red.maxX) / 2 - 320)).toBeLessThanOrEqual(2);
  expect(Math.abs((red.minY + red.maxY) / 2 - 180)).toBeLessThanOrEqual(2);
  const translucent = await render("background-translucent", { text: "BOX", width: 0.5, background: "rgba(255,0,0,0.5)", opacity: 0.5 });
  const sample = (180 * 640 + 175) * 3;
  expect(translucent[sample]).toBeGreaterThan(45); expect(translucent[sample]).toBeLessThan(85);
}, 30_000);

it("libass loads all nine exact static Inter instances without substituting Arial", async () => {
  const dir = dataPath("overlay-font-selection");
  await mkdir(dir, { recursive: true });
  let ass = buildAss([], defaultCaptionStyle, 640, 360, false);
  for (let weight = 100; weight <= 900; weight += 100) {
    ass += buildTextOverlayDialogue("Inter", { start: 0, end: 0.6, x: 0.5, y: weight / 1000,
      fontScale: 0.05, color: "#ffffff", rotation: 0, bold: true, opacity: 1,
      fontFamily: "Inter", fontWeight: weight }, 640, 360) + "\n";
  }
  const file = path.join(dir, "fonts.ass");
  await writeFile(file, ass);
  const escape = (value: string) => value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const result = await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=navy:s=640x360:d=0.6", "-vf", assFilter(file, escape),
    "-frames:v", "1", "-f", "null", "-"]);
  for (let weight = 100; weight <= 900; weight += 100) expect(result.stderr).toContain(`-> InterOverlay-${weight},`);
  if (process.env.CLIP_OVERLAY_EVIDENCE === "1") await writeFile(path.join(process.cwd(), ".test-artifacts", "overlay-export", "inter-font-selection.log"), result.stderr);
}, 30_000);

it("real explicit Inter glyph dimensions follow em-sized local preview font metrics", async () => {
  const context = createCanvas(1, 1).getContext("2d");
  const pixels: Buffer[] = [];
  for (const weight of [400, 800]) {
    pixels.push(await render(`inter-${weight}`, { text: "Overlay WMWM", fontFamily: "Inter, system-ui, sans-serif", fontWeight: weight, width: 0.9 }));
    const family = `Inter Overlay ${weight}`;
    if (!GlobalFonts.has(family)) GlobalFonts.registerFromPath(path.join(process.cwd(), "public", "fonts", "captions", `Inter-Text-${weight}.ttf`), family);
    context.font = `${weight} 18px "${family}"`;
    const metrics = context.measureText("Overlay WMWM");
    expect(Math.abs(bounds(pixels.at(-1)!, white).width - (metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft))).toBeLessThanOrEqual(5);
  }
  const countWhite = (value: Buffer) => {
    let count = 0;
    for (let index = 0; index < value.length; index += 3) if (white(value[index], value[index + 1], value[index + 2])) count++;
    return count;
  };
  expect(countWhite(pixels[1])).toBeGreaterThan(countWhite(pixels[0]) * 1.25);
}, 30_000);
