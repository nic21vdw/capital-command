import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { INTERMEDIATE_CRF, INTERMEDIATE_PRESET, MASTER_AUDIO_BITRATE, MASTER_CRF, MASTER_PRESET, SCALE_FLAGS } from "@/lib/clipping/encode";
import type { Edl, EdlSegment } from "@/lib/story/types";

export const PAD_SEC = 0.5;
export const CROSSFADE_SEC = 0.015;
export const LOUDNESS_TARGET = { integrated: -14, truePeak: -1.5, range: 11 };
const PUSH_OVERSAMPLE = 2;
const MAX_CHUNK_GAP_SEC = 60;

export type Chunk = { index: number; segments: EdlSegment[]; base: number; head: number; tail: number; audioSec: number; lead: number };

export function planChunks(edl: Edl, sourceDurationSec: number): Chunk[] {
  const enabled = edl.segments.filter((segment) => segment.enabled);
  const groups: EdlSegment[][] = [];
  for (const segment of enabled) {
    const group = groups[groups.length - 1];
    const last = group?.[group.length - 1];
    const continues = last && segment.transition !== "j-cut" && segment.in >= last.out - 1e-6 && segment.in - last.out < MAX_CHUNK_GAP_SEC;
    if (continues) group.push(segment);
    else groups.push([segment]);
  }
  return groups.map((segments, index) => {
    const first = segments[0];
    const last = segments[segments.length - 1];
    const base = Math.max(0, first.in - PAD_SEC);
    const audioSec = segments.reduce((sum, segment) => sum + (segment.out - segment.in), 0);
    const lead = index === 0 ? 0 : Math.min(first.audioLeadSec, (first.out - first.in) / 2, PAD_SEC);
    return {
      index,
      segments,
      base,
      head: first.in - base,
      tail: Math.min(PAD_SEC, Math.max(0, sourceDurationSec - last.out)),
      audioSec,
      lead
    };
  });
}

const even = (value: number) => Math.max(2, 2 * Math.floor(value / 2));
const fixed = (value: number) => value.toFixed(4);

export function zoomFilter(segment: EdlSegment, width: number, height: number, fps: number): string {
  const ax = Math.min(1, Math.max(0, segment.anchorX));
  const ay = Math.min(1, Math.max(0, segment.anchorY));
  if (segment.zoomTo !== segment.zoom) {
    const duration = Math.min(6, Math.max(0.5, segment.out - segment.in));
    const bigW = even(width * PUSH_OVERSAMPLE);
    const bigH = even(height * PUSH_OVERSAMPLE);
    const p = `min(1,it/${fixed(duration)})`;
    const z = `${fixed(segment.zoom)}+${fixed(segment.zoomTo - segment.zoom)}*(${p})*(${p})*(3-2*(${p}))`;
    const x = `max(0,min(iw-iw/zoom,${fixed(ax)}*iw-iw/zoom/2))`;
    const y = `max(0,min(ih-ih/zoom,${fixed(ay)}*ih-ih/zoom/2))`;
    return `scale=${bigW}:${bigH}:flags=${SCALE_FLAGS},zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${width}x${height}:fps=${fps},setsar=1`;
  }
  if (segment.zoom <= 1.0005) return "setsar=1";
  const cropW = even(width / segment.zoom);
  const cropH = even(height / segment.zoom);
  const cropX = Math.round(Math.min(width - cropW, Math.max(0, ax * width - cropW / 2)));
  const cropY = Math.round(Math.min(height - cropH, Math.max(0, ay * height - cropH / 2)));
  return `crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${width}:${height}:flags=${SCALE_FLAGS},setsar=1`;
}

export function chunkFilter(chunk: Chunk, width: number, height: number, fps: number): string {
  const n = chunk.segments.length;
  const lines: string[] = [];
  lines.push(`[0:v]fps=${fps},split=${n}${chunk.segments.map((_, k) => `[vs${k}]`).join("")}`);
  lines.push(`[0:a]aresample=48000,asplit=${n}${chunk.segments.map((_, k) => `[as${k}]`).join("")}`);
  chunk.segments.forEach((segment, k) => {
    const start = k === 0 ? 0 : segment.in - chunk.base;
    const end = k === n - 1 ? segment.out - chunk.base + chunk.tail : segment.out - chunk.base;
    lines.push(`[vs${k}]trim=start=${fixed(start)}:end=${fixed(end)},setpts=PTS-STARTPTS,${zoomFilter(segment, width, height, fps)}[v${k}]`);
    lines.push(
      `[as${k}]atrim=start=${fixed(segment.in - chunk.base)}:end=${fixed(segment.out - chunk.base + CROSSFADE_SEC)},asetpts=PTS-STARTPTS[a${k}]`
    );
  });
  lines.push(`${chunk.segments.map((_, k) => `[v${k}]`).join("")}concat=n=${n}:v=1:a=0,format=yuv420p[vout]`);
  let current = "a0";
  for (let k = 1; k < n; k++) {
    const next = k === n - 1 ? "aout" : `ax${k}`;
    lines.push(`[${current}][a${k}]acrossfade=d=${CROSSFADE_SEC}:c1=tri:c2=tri[${next}]`);
    current = next;
  }
  if (n === 1) lines.push(`[a0]anull[aout]`);
  return lines.join(";\n");
}

export function chunkArgs(chunk: Chunk, sourcePath: string, filterPath: string, outPath: string): string[] {
  const last = chunk.segments[chunk.segments.length - 1];
  return [
    "-hide_banner", "-v", "error", "-y",
    "-ss", fixed(chunk.base),
    "-to", fixed(last.out + chunk.tail + CROSSFADE_SEC + 0.1),
    "-i", sourcePath,
    "-/filter_complex", filterPath,
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", INTERMEDIATE_PRESET, "-crf", String(INTERMEDIATE_CRF),
    "-c:a", "pcm_s16le", "-ar", "48000",
    outPath
  ];
}

export function audioAssembly(chunks: Chunk[]): string {
  const lines: string[] = [];
  let current = "0:a";
  for (let k = 1; k < chunks.length; k++) {
    const next = `am${k}`;
    lines.push(`[${current}][${k}:a]acrossfade=d=${CROSSFADE_SEC}:c1=tri:c2=tri[${next}]`);
    current = next;
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.audioSec, 0);
  lines.push(`[${current}]atrim=end=${fixed(total)},asetpts=PTS-STARTPTS,highpass=f=70,afftdn=nr=8:nf=-45[aclean]`);
  return lines.join(";\n");
}

export function videoAssembly(chunks: Chunk[]): string {
  const lines: string[] = [];
  chunks.forEach((chunk, k) => {
    const nextLead = chunks[k + 1]?.lead ?? 0;
    const start = chunk.head + chunk.lead;
    const end = chunk.head + chunk.audioSec + nextLead;
    lines.push(`[${k}:v]trim=start=${fixed(start)}:end=${fixed(end)},setpts=PTS-STARTPTS[cv${k}]`);
  });
  lines.push(`${chunks.map((_, k) => `[cv${k}]`).join("")}concat=n=${chunks.length}:v=1:a=0[vfinal]`);
  return lines.join(";\n");
}

export type LoudnessMeasure = { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string };

export function loudnormFilter(measured?: LoudnessMeasure): string {
  const base = `loudnorm=I=${LOUDNESS_TARGET.integrated}:TP=${LOUDNESS_TARGET.truePeak}:LRA=${LOUDNESS_TARGET.range}`;
  if (!measured) return `${base}:print_format=json`;
  return `${base}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=json`;
}

export function parseLoudnorm(stderr: string): LoudnessMeasure & { output_i?: string; output_tp?: string } {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("loudnorm printed no measurement");
  return JSON.parse(stderr.slice(start, end + 1));
}

export function finalArgs(chunkFiles: string[], filterPath: string, outPath: string, fps: number): string[] {
  return [
    "-hide_banner", "-v", "error", "-y",
    ...chunkFiles.flatMap((file) => ["-i", file]),
    "-/filter_complex", filterPath,
    "-map", "[vfinal]", "-map", "[afinal]",
    "-c:v", "libx264", "-preset", MASTER_PRESET, "-crf", String(MASTER_CRF), "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-r", String(fps), "-g", String(Math.round(fps / 2)), "-bf", "2",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-c:a", "aac", "-b:a", MASTER_AUDIO_BITRATE, "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    outPath
  ];
}

export function runProcess(command: string, args: string[], onLine?: (line: string) => void): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr = (stderr + text).slice(-200_000);
      if (onLine) for (const line of text.split(/\r?\n/)) if (line.trim()) onLine(line);
    });
    child.stdout.on("data", () => undefined);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve({ stderr }) : reject(new Error(`${command} exited ${code}: ${stderr.slice(-1500)}`))));
  });
}

async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    })
  );
}

export type RenderResult = { file: string; loudness: { integrated: number; truePeak: number }; chunks: number };

export async function renderEdl(input: {
  edl: Edl;
  sourcePath: string;
  sourceDurationSec: number;
  workDir: string;
  outPath: string;
  parallel?: number;
  log?: (message: string) => void;
}): Promise<RenderResult> {
  const { edl, workDir } = input;
  const log = input.log ?? (() => undefined);
  await mkdir(workDir, { recursive: true });
  const chunks = planChunks(edl, input.sourceDurationSec);
  const chunkFiles = chunks.map((chunk) => path.join(workDir, `chunk-${String(chunk.index).padStart(3, "0")}.mkv`));
  let done = 0;
  await pool(chunks, input.parallel ?? 4, async (chunk) => {
    const filterPath = path.join(workDir, `chunk-${String(chunk.index).padStart(3, "0")}.filter`);
    await writeFile(filterPath, chunkFilter(chunk, edl.width, edl.height, edl.fps));
    await runProcess("ffmpeg", chunkArgs(chunk, input.sourcePath, filterPath, chunkFiles[chunk.index]));
    log(`chunk ${++done}/${chunks.length} rendered`);
  });

  const measureFilter = path.join(workDir, "measure.filter");
  await writeFile(measureFilter, `${audioAssembly(chunks)};\n[aclean]${loudnormFilter()}[afinal]`);
  const measured = await runProcess("ffmpeg", [
    "-hide_banner", "-y", ...chunkFiles.flatMap((file) => ["-i", file]),
    "-/filter_complex", measureFilter, "-map", "[afinal]", "-f", "null", "-"
  ]);
  const measure = parseLoudnorm(measured.stderr);
  log(`measured ${measure.input_i} LUFS / ${measure.input_tp} dBTP before normalising`);

  const finalFilter = path.join(workDir, "final.filter");
  await writeFile(finalFilter, `${videoAssembly(chunks)};\n${audioAssembly(chunks)};\n[aclean]${loudnormFilter(measure)},aresample=48000[afinal]`);
  await runProcess("ffmpeg", finalArgs(chunkFiles, finalFilter, input.outPath, edl.fps));
  const loudness = await measureLoudness(input.outPath);
  log(`final ${loudness.integrated} LUFS / ${loudness.truePeak} dBTP`);
  return { file: input.outPath, loudness, chunks: chunks.length };
}

export async function measureLoudness(file: string): Promise<{ integrated: number; truePeak: number }> {
  const { stderr } = await runProcess("ffmpeg", ["-hide_banner", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const integrated = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
  const truePeak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);
  return { integrated, truePeak };
}
