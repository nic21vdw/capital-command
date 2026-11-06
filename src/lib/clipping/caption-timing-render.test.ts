import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import { buildAss } from "@/lib/clipping/captions";
import { assFilter } from "@/lib/clipping/caption-fonts";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { remapClipCaptions } from "@/lib/clipping/segments";
import { dataPath } from "@/lib/paths";
import { defaultCaptionStyle } from "@/lib/storage/schemas";
import type { CaptionSegment } from "@/types/domain";

let dir: string;
beforeAll(async () => { dir = await mkdtemp(dataPath("caption-timing-")); });
const style = { ...defaultCaptionStyle, animation: "none" as const, position: "middle" as const,
  fontScale: 0.12, outlineWidth: 1, shadow: 0, wordsPerLine: 4 };
const escapePath = (file: string) => file.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
async function render(name: string, captions: CaptionSegment[], highlight: boolean) {
  const ass = buildAss(captions, style, 320, 180, highlight);
  const assPath = path.join(dir, `${name}.ass`);
  const video = path.join(dir, `${name}.mp4`);
  await writeFile(assPath, ass, "utf8");
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=navy:s=320x180:r=10:d=1.2", "-vf", assFilter(assPath, escapePath),
    "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "0", "-pix_fmt", "yuv420p", video]);
  const { stdout } = await runFfmpeg(["-protocol_whitelist", "file", "-i", video, "-an", "-f", "framemd5", "-"]);
  const frames = stdout.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => line.split(",").at(-1)!.trim());
  if (process.env.CLIP_CAPTION_EVIDENCE === "1") {
    const evidence = path.join(process.cwd(), ".test-artifacts", "caption-timing");
    await mkdir(evidence, { recursive: true });
    await copyFile(video, path.join(evidence, `${name}.mp4`));
    await copyFile(assPath, path.join(evidence, `${name}.ass`));
    await writeFile(path.join(evidence, `${name}.json`), JSON.stringify({ syntheticOnly: true, fps: 10, frames, captions, highlight }, null, 2));
  }
  return { frames, ass };
}

it("decoded frames show plain phrases during word gaps and highlight only spoken intervals", async () => {
  const caption: CaptionSegment = { id: "gap", start: 0, end: 1.2, text: "HELLO WORLD", enabled: true,
    words: [{ text: "HELLO", start: 0.2, end: 0.4 }, { text: "WORLD", start: 0.9, end: 1.1 }] };
  const timed = await render("word-gaps", [caption], true);
  const plain = await render("plain-reference", [caption], false);
  expect(timed.frames).toHaveLength(12);
  // 0.1 s before the first word, 0.6 s in the gap, and 1.1 s after the last.
  for (const frame of [1, 6, 11]) expect(timed.frames[frame]).toBe(plain.frames[frame]);
  // 0.3 s and 1.0 s are inside the two actual spoken-word intervals.
  for (const frame of [3, 10]) expect(timed.frames[frame]).not.toBe(plain.frames[frame]);
}, 30_000);

it("decoded plain and highlighted exports omit words removed by a timeline cut", async () => {
  const source: CaptionSegment = { id: "cut", start: 0, end: 1.6, text: "KEEP REMOVED LATER", enabled: true,
    words: [{ text: "KEEP", start: 0, end: 0.2 }, { text: "REMOVED", start: 0.6, end: 0.8 }, { text: "LATER", start: 1, end: 1.6 }] };
  const remapped = remapClipCaptions([source], [{ start: 0, end: 0.4 }, { start: 1, end: 1.6 }]);
  const expected: CaptionSegment = { id: "expected", start: 0, end: 1, text: "KEEP LATER", enabled: true,
    words: [{ text: "KEEP", start: 0, end: 0.2 }, { text: "LATER", start: 0.4, end: 1 }] };
  for (const highlight of [false, true]) {
    const actual = await render(`removed-word-${highlight}`, remapped, highlight);
    const reference = await render(`kept-reference-${highlight}`, [expected], highlight);
    expect(actual.ass).not.toContain("REMOVED");
    expect(actual.frames).toEqual(reference.frames);
  }
}, 30_000);
