import { config } from "dotenv";
import path from "node:path";
config({ path: path.join(process.cwd(), ".env"), quiet: true });
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { detectDisfluencies } from "@/lib/story/cleanup";
import { buildEdl, timelineWords, type EdlUnit } from "@/lib/story/edl";
import { alignedWords, SCREEN_OVERLAYS, type Analysis } from "@/lib/story/pipeline";
import { shortCaptionsAss } from "@/lib/story/publish";
import type { Pane } from "@/lib/story/shots";
import { projectFile, readJson, readOverrides, readStatus } from "@/lib/story/store";
import type { Transcript } from "@/lib/story/types";

type BrollIdea = { source?: string | number; text?: string[]; why?: string; at?: number; dur?: number; crop?: { x: number; y: number; w: number; h: number } };
type ScreenHint = { from: number; crop: { x: number; y: number; w: number; h: number } };
type ClipSpec = {
  id: string;
  title: string;
  units: { from: string; to: string; drop?: string[] };
  cold?: string[];
  cutWords?: number[];
  broll?: BrollIdea[];
  screens?: ScreenHint[];
  captionY?: number;
  screenHeight?: number;
};

const CAM = { w: 1080, h: 608 };
const SCREEN_ASPECT = 1080 / (1920 - 608);
const CARD_W = 760;
const CARD_H = 428;
const MIN_SCREEN_HOLD_SEC = 4;
const TERMS: Record<string, string> = {
  vivecoder: "VIBE CODING",
  vivecode: "VIBE CODE",
  vibecoded: "VIBE-CODED",
  grock: "GROK",
  collateral: "COLATERAL",
  colab: "COLATERAL",
  collateralai: "COLATERALAI",
  aster: "ASTRA",
  bridgeminds: "BRIDGEMIND",
  "bridgemind's": "BRIDGEMIND'S"
};

function seconds(value: string | number): number {
  if (typeof value === "number") return value;
  return value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

function python(args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(process.env.STORY_PYTHON || "python", args, { maxBuffer: 1 << 24, windowsHide: true }, (error, stdout, stderr) =>
      error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve(String(stdout))
    )
  );
}

async function main() {
  const id = process.argv[2];
  const only = process.argv[3]?.startsWith("--") ? undefined : process.argv[3];
  const status = await readStatus(id);
  const analysis = await readJson<Analysis>(projectFile(id, "analysis.json"));
  const transcript = await readJson<Transcript>(projectFile(id, "transcript.json"));
  const pane = await readJson<Pane>(projectFile(id, "pane.json"));
  const clips = (await readJson<ClipSpec[]>(projectFile(id, "shorts", "clips.json"))) ?? [];
  if (!status || !analysis || !transcript || !pane) throw new Error("Run the story edit first.");
  const overrides = await readOverrides(id);
  const order = new Map(analysis.units.map((unit, index) => [unit.id, index]));
  const fontsDir = "../fonts";

  for (const clip of clips.filter((entry) => !only || entry.id === only)) {
    const from = order.get(clip.units.from)!;
    const to = order.get(clip.units.to)!;
    const drop = new Set([...(clip.units.drop ?? []), ...overrides.disabledUnitIds.filter(() => false)]);
    const body = analysis.units.slice(from, to + 1).filter((unit) => !drop.has(unit.id));
    const cold = (clip.cold ?? []).map((unitId) => analysis.units[order.get(unitId)!]);
    const units = [...cold, ...body];
    const removed = new Set([...detectDisfluencies(transcript.words).map((flag) => flag.index), ...(overrides.cutWords ?? []), ...(clip.cutWords ?? [])]);
    const words = await alignedWords(id, transcript.words, units, (message) => console.log(`[${clip.id}] ${message}`), removed);
    const fresh = detectDisfluencies(transcript.words);
    const extra = [...(overrides.cutWords ?? []), ...(clip.cutWords ?? [])];
    const flags = [...fresh, ...extra.filter((index) => !fresh.some((flag) => flag.index === index)).map((index) => ({ index, kind: "false-start" as const }))].sort(
      (a, b) => a.index - b.index
    );
    const entries: EdlUnit[] = units.map((unit, index) => ({
      unit,
      section: index < cold.length ? "hook" : "development",
      key: false,
      dramatic: index === cold.length - 1,
      tag: index < cold.length ? "cold" : undefined
    }));
    const { edl } = buildEdl({
      source: status.sourcePath,
      fps: 30,
      width: 1920,
      height: 1080,
      words,
      flags,
      units: entries,
      envelope: null,
      hopSec: 0.01,
      anchorFor: () => ({ x: 0.5, y: 0.5, source: "frame" })
    });
    const baseSegments = edl.segments.map((segment) => ({ in: segment.in, out: segment.out, unitId: segment.unitId }));
    const tWords = timelineWords(edl.segments, words);
    const dir = projectFile(id, "shorts", clip.id);
    await mkdir(dir, { recursive: true });

    const exclude = SCREEN_OVERLAYS(pane);
    const screenH = clip.screenHeight ?? 780;
    const screenW = Math.round(screenH * SCREEN_ASPECT);
    const unitSpans = [...new Set(edl.segments.map((segment) => segment.unitId))].map((unitId) => {
      const own = edl.segments.filter((segment) => segment.unitId === unitId);
      return { id: `u:${unitId}`, start: own[0].in, end: own[own.length - 1].out + 0.5, w: screenW, h: screenH, fps: 2 };
    });
    const ideas = (clip.broll ?? []).slice(0, 5);
    const request = {
      exclude,
      items: [
        { id: "screen", start: baseSegments[0].in, end: baseSegments[baseSegments.length - 1].out, w: screenW, h: screenH, fps: 0.5 },
        ...unitSpans,
        ...ideas
          .map((idea, index) => ({ idea, index }))
          .filter(({ idea }) => idea.source !== undefined && !idea.crop)
          .map(({ idea, index }) => ({ id: `b${index}`, start: seconds(idea.source!), end: seconds(idea.source!) + 2.5, w: CARD_W, h: CARD_H, fps: 2 }))
      ]
    };
    await writeFile(path.join(dir, "windows.json"), JSON.stringify(request));
    const windows = JSON.parse(await python([path.join("scripts", "story", "screen_window.py"), status.sourcePath, path.join(dir, "windows.json")])) as Record<
      string,
      { x: number; y: number; w: number; h: number }
    >;

    let held = windows.screen;
    let heldSince = 0;
    let cursor = 0;
    const hints = [...(clip.screens ?? [])].sort((a, b) => a.from - b.from);
    const segments = baseSegments.map((segment) => {
      const hint = hints.filter((entry) => entry.from <= cursor + 0.01).pop();
      if (hint) {
        cursor += segment.out - segment.in;
        return { in: segment.in, out: segment.out, screen: hint.crop };
      }
      const wanted = windows[`u:${segment.unitId}`] ?? held;
      if (cursor - heldSince >= MIN_SCREEN_HOLD_SEC && Math.hypot(wanted.x - held.x, wanted.y - held.y) > 160) {
        held = wanted;
        heldSince = cursor;
      }
      cursor += segment.out - segment.in;
      return { in: segment.in, out: segment.out, screen: held };
    });
    const runtime = edl.runtimeSec;
    const spacing = ideas.length ? (runtime - 4) / ideas.length : 0;
    const broll = ideas.map((idea, index) => ({
      source: idea.source === undefined ? 0 : seconds(idea.source),
      text: idea.text,
      at: idea.at ?? Math.min(runtime - 3, 3 + index * spacing + spacing * 0.35),
      dur: idea.dur ?? 2.4,
      crop: idea.crop ?? windows[`b${index}`],
      width: 1000,
      why: idea.why ?? ""
    }));

    const px = (value: number, size: number) => Math.round(value * size);
    const camW = Math.min(px(pane.x1 - pane.x0, 1920), Math.round(px(pane.y1 - pane.y0, 1080) * (CAM.w / CAM.h)));
    const camH = Math.round(camW * (CAM.h / CAM.w)) & ~1;
    const camera = {
      w: camW & ~1,
      h: camH,
      x: px(pane.x0, 1920) + Math.round((px(pane.x1 - pane.x0, 1920) - camW) / 2),
      y: px(pane.y0, 1080) + Math.max(0, Math.round((px(pane.y1 - pane.y0, 1080) - camH) / 2))
    };

    await writeFile(
      path.join(dir, "captions.ass"),
      shortCaptionsAss(tWords, { width: 1080, height: 1920, centerY: clip.captionY ?? 640, maxWords: 3, maxChars: 16, terms: TERMS }),
      "utf8"
    );
    await writeFile(
      path.join(dir, "captions_wide.ass"),
      shortCaptionsAss(tWords, { width: 1920, height: 1080, centerY: 930, maxWords: 4, maxChars: 26, terms: TERMS, fontSize: 78 }),
      "utf8"
    );
    const out = path.join(dir, `${clip.id}.mp4`);
    const plan = {
      source: status.sourcePath,
      windowStart: Math.max(0, segments[0].in - 0.2),
      segments,
      camera,
      screen: windows.screen,
      broll,
      fontsDir,
      out,
      outWide: path.join(dir, `${clip.id}-16x9.mp4`)
    };
    await writeFile(path.join(dir, "plan.json"), JSON.stringify(plan, null, 2));
    await writeFile(path.join(dir, "words.json"), JSON.stringify(tWords));
    console.log(`[${clip.id}] ${segments.length} cuts, ${runtime.toFixed(1)}s, screen x=${windows.screen?.x}, ${broll.length} b-roll`);
    if (process.argv.includes("--plan-only")) continue;
    const result = await python([path.join("scripts", "story", "shorts_compose.py"), path.join(dir, "plan.json")]);
    console.log(`[${clip.id}] rendered ${result.trim()}`);
    const wide = await python([path.join("scripts", "story", "shorts_compose.py"), path.join(dir, "plan.json"), "wide"]);
    console.log(`[${clip.id}] rendered ${wide.trim()}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

void readFile;
