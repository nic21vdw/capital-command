import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { askCopy, askStory } from "@/lib/story/ai";
import { cleanRange, countFillers, detectDisfluencies, fillerIndices, norm, type WordFlag } from "@/lib/story/cleanup";
import { buildEdl, retime, silenceThreshold, timelineWords, zoomAnchor, type EdlUnit, type TimelineWord } from "@/lib/story/edl";
import {
  buildDescription,
  buildSrt,
  chapterBlock,
  chapterClock,
  chaptersFromTimeline,
  draftTitle,
  thumbnailsMarkdown,
  titlesMarkdown,
  TITLE_MAX_CHARS,
  validateChapters,
  validateTitles
} from "@/lib/story/publish";
import { measureLoudness, renderEdl, runProcess, LOUDNESS_TARGET } from "@/lib/story/render";
import {
  combineScores,
  deliveryScore,
  describeUnit,
  heuristicStory,
  percentile,
  samplesIn,
  scoreAudio,
  scoreVisual,
  visualBaseline,
  visualScore
} from "@/lib/story/scoring";
import {
  exists,
  packageFile,
  projectFile,
  readJson,
  readOverrides,
  readStatus,
  updateStatus,
  writeJson,
  type StoryStage
} from "@/lib/story/store";
import {
  buildMoments,
  fitRuntime,
  formatClock,
  heuristicLoops,
  heuristicPlan,
  HOOK_MAX_SEC,
  MIN_OPEN_LOOPS,
  orderedUnitIds,
  SECTION_ORDER,
  TARGET_AIM_SEC,
  TARGET_MAX_SEC,
  TARGET_MIN_SEC,
  validLoops
} from "@/lib/story/story";
import type { Chapter, Edl, Moment, SectionRole, StoryCopy, StoryPlan, Transcript, Unit, VisualSample, VisualTrack, Word } from "@/lib/story/types";
import { bestTake, contentTokens, findRetakeGroups, splitUnits } from "@/lib/story/units";
import { readBackVideo, studioLink, storyVideoBody, uploadCaptions, uploadStoryVideo, verifyPrivate } from "@/lib/story/youtube";

const HOP_SEC = 0.01;
const VISUAL_WORKERS = 6;
const PYTHON = process.env.STORY_PYTHON?.trim() || "python";

type Log = (message: string) => void;

function script(name: string): string {
  return path.join(process.cwd(), "scripts", "story", name);
}

function faceModel(): string {
  return path.join(process.cwd(), "data", "clips", "bin", "face_detection_yunet_2023mar.onnx");
}

async function loadEnvelope(id: string): Promise<Float32Array | null> {
  try {
    const buffer = await readFile(projectFile(id, "envelope.f32"));
    return new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4));
  } catch {
    return null;
  }
}

async function sourceDuration(file: string): Promise<number> {
  const { execFile } = await import("node:child_process");
  const probe = await new Promise<string>((resolve) =>
    execFile("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], (_error, stdout) => resolve(String(stdout)))
  );
  return Number(probe.trim()) || 0;
}

export async function analyzeStage(id: string, log: Log): Promise<void> {
  const status = await readStatus(id);
  if (!status) throw new Error(`No story project ${id}.`);
  const source = status.sourcePath;
  const wav = projectFile(id, "audio16k.wav");
  if (!(await exists(projectFile(id, "transcript.json")))) {
    if (!(await exists(wav))) await runProcess("ffmpeg", ["-v", "error", "-y", "-i", source, "-vn", "-ac", "1", "-ar", "16000", wav]);
    log("transcribing with word timestamps");
    await runProcess(PYTHON, [script("transcribe.py"), wav, projectFile(id, "transcript.json")]);
  }
  if (!(await exists(projectFile(id, "envelope.f32")))) {
    if (!(await exists(wav))) await runProcess("ffmpeg", ["-v", "error", "-y", "-i", source, "-vn", "-ac", "1", "-ar", "16000", wav]);
    await runProcess(PYTHON, [script("envelope.py"), wav, projectFile(id, "envelope.f32")]);
  }
  if (!(await exists(projectFile(id, "visual.json")))) {
    const duration = status.durationSec || (await sourceDuration(source));
    const span = Math.ceil(duration / VISUAL_WORKERS);
    log(`analysing picture on a 720p proxy in ${VISUAL_WORKERS} workers`);
    const parts = Array.from({ length: VISUAL_WORKERS }, (_, k) => projectFile(id, `visual.part${k}.json`));
    await Promise.all(
      parts.map((part, k) =>
        exists(part).then((done) =>
          done
            ? undefined
            : runProcess(PYTHON, [script("analyze_video.py"), source, part, "--model", faceModel(), "--start", String(k * span), "--duration", String(span)])
        )
      )
    );
    await mergeVisualParts(id, parts);
  }
}

export async function mergeVisualParts(id: string, parts: string[]): Promise<void> {
  const tracks = await Promise.all(parts.map((part) => readJson<VisualTrack>(part)));
  const first = tracks.find(Boolean);
  if (!first) throw new Error("Video analysis produced nothing.");
  const samples = tracks.flatMap((track) => track?.samples ?? []).sort((a, b) => a.t - b.t);
  await writeJson(projectFile(id, "visual.json"), { ...first, samples });
  await Promise.all(parts.map((part) => rm(part, { force: true })));
}

export type Analysis = {
  units: Unit[];
  moments: Moment[];
  flags: WordFlag[];
  retakeGroups: string[][];
  sourceFillers: number;
};

function tokenRarity(units: Array<{ text: string }>): (token: string) => number {
  const df = new Map<string, number>();
  for (const unit of units) for (const token of new Set(contentTokens(unit.text))) df.set(token, (df.get(token) ?? 0) + 1);
  const total = Math.max(2, units.length);
  return (token) => Math.max(0, Math.min(1, 1 - Math.log(df.get(token) ?? 1) / Math.log(total)));
}

export async function scoreStage(id: string, log: Log): Promise<Analysis> {
  const transcript = await readJson<Transcript>(projectFile(id, "transcript.json"));
  const visual = await readJson<VisualTrack>(projectFile(id, "visual.json"));
  if (!transcript?.words?.length) throw new Error("The transcript has no words.");
  const samples = visual?.samples ?? [];
  const envelope = await loadEnvelope(id);
  const words = transcript.words;
  const flags = detectDisfluencies(words);
  const raw = splitUnits(words);
  const rarity = tokenRarity(raw);
  const baseline = visualBaseline(samples);
  const speechLevels: number[] = [];
  if (envelope) for (let k = 0; k < envelope.length; k += 50) if (envelope[k] > -60) speechLevels.push(envelope[k]);
  const medianDb = percentile(speechLevels, 0.5);

  const units: Unit[] = raw.map((unit) => {
    const audio = scoreAudio(words, unit.firstWord, unit.lastWord, envelope, HOP_SEC, medianDb);
    const visualScores = scoreVisual(samplesIn(samples, unit.start, unit.end), baseline);
    const story = heuristicStory(unit.text, rarity);
    const scores = combineScores({
      story: story.story,
      clarity: audio.clarity,
      emotion: Math.round(((story.emotion + audio.energy) / 2) * 1000) / 1000,
      visual: visualScore(visualScores),
      delivery: deliveryScore(audio),
      novelty: story.novelty
    });
    return { ...unit, audio, visual: visualScores, scores, reason: describeUnit(scores, audio, visualScores) };
  });

  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const retakeGroups = findRetakeGroups(units.map((unit) => ({ ...unit, combined: unit.scores.combined })));
  retakeGroups.forEach((group, index) => {
    const keep = bestTake(group, new Map(group.map((unitId) => [unitId, { ...byId.get(unitId)!, combined: byId.get(unitId)!.scores.combined }])));
    for (const unitId of group) {
      const unit = byId.get(unitId)!;
      unit.retakeGroup = `r${index + 1}`;
      if (unitId !== keep) {
        unit.retakeOf = keep;
        unit.reason = `${unit.reason}; weaker take of ${keep} (combined ${unit.scores.combined} vs ${byId.get(keep)!.scores.combined})`;
      }
    }
  });

  const moments = buildMoments(units);
  const analysis: Analysis = { units, moments, flags, retakeGroups, sourceFillers: flags.filter((flag) => flag.kind === "filler").length };
  await writeJson(projectFile(id, "analysis.json"), analysis);
  log(`${units.length} sentence units, ${moments.length} moments, ${flags.length} disfluencies, ${retakeGroups.length} retake groups`);
  return analysis;
}

function cleanedSeconds(unit: Unit, words: Word[], flagged: Map<number, WordFlag["kind"]>): number {
  return cleanRange(words, unit.firstWord, unit.lastWord, flagged).ranges.reduce((sum, range) => sum + (range.end - range.start), 0);
}

function runtimeFn(analysis: Analysis, words: Word[]): (momentId: string) => number {
  const flagged = new Map(analysis.flags.map((flag) => [flag.index, flag.kind]));
  const units = new Map(analysis.units.map((unit) => [unit.id, unit]));
  const cache = new Map<string, number>();
  const moments = new Map(analysis.moments.map((moment) => [moment.id, moment]));
  return (momentId) => {
    if (!cache.has(momentId)) {
      const moment = moments.get(momentId);
      const total = (moment?.unitIds ?? [])
        .map((unitId) => units.get(unitId)!)
        .filter((unit) => unit && !unit.retakeOf)
        .reduce((sum, unit) => sum + cleanedSeconds(unit, words, flagged), 0);
      cache.set(momentId, total);
    }
    return cache.get(momentId)!;
  };
}

export const HOOK_MIN_SEC = 10;
const HOOK_EXTEND_TO_SEC = 14;

function trimHook(ids: string[], units: Map<string, Unit>, words: Word[], flagged: Map<number, WordFlag["kind"]>, ordered: Unit[]): string[] {
  const kept: string[] = [];
  let total = 0;
  for (const unitId of ids) {
    const unit = units.get(unitId);
    if (!unit) continue;
    const seconds = cleanedSeconds(unit, words, flagged);
    if (kept.length && total + seconds > HOOK_MAX_SEC) break;
    kept.push(unitId);
    total += seconds;
  }
  if (kept.length === 0 || total >= HOOK_MIN_SEC) return kept;
  let index = ordered.findIndex((unit) => unit.id === kept[kept.length - 1]);
  while (total < HOOK_EXTEND_TO_SEC && ++index < ordered.length) {
    const next = ordered[index];
    const previous = ordered[index - 1];
    if (next.start - previous.end > 2.5) break;
    if (next.retakeOf) continue;
    const seconds = cleanedSeconds(next, words, flagged);
    if (total + seconds > HOOK_MAX_SEC) break;
    kept.push(next.id);
    total += seconds;
  }
  return kept;
}

export async function storyStage(id: string, log: Log): Promise<StoryPlan> {
  const analysis = await readJson<Analysis>(projectFile(id, "analysis.json"));
  const transcript = await readJson<Transcript>(projectFile(id, "transcript.json"));
  const status = await readStatus(id);
  if (!analysis || !transcript) throw new Error("Score the footage before planning the story.");
  const words = transcript.words;
  const units = new Map(analysis.units.map((unit) => [unit.id, unit]));
  const flagged = new Map(analysis.flags.map((flag) => [flag.index, flag.kind]));
  const runtimeOf = runtimeFn(analysis, words);
  const usable = analysis.moments.filter((moment) => runtimeOf(moment.id) >= 12);
  const pool = [...usable].sort((a, b) => b.score - a.score).slice(0, 80).sort((a, b) => a.start - b.start);

  let plan = await readJson<StoryPlan>(projectFile(id, "story-ai.json"));
  if (!plan) {
    log(`asking the story editor to structure ${pool.length} candidate moments`);
    plan = await askStory({ title: status?.title ?? id, targetSec: TARGET_AIM_SEC, moments: pool, units, runtimeOf }).catch(() => null);
    if (plan) await writeJson(projectFile(id, "story-ai.json"), plan);
  }
  if (!plan) {
    log("story editor unavailable, using the offline planner");
    plan = heuristicPlan(pool, analysis.units);
  }
  if (plan.hookUnitIds.length === 0) {
    const fallback = heuristicPlan(pool, analysis.units);
    plan.hookUnitIds = fallback.hookUnitIds;
    plan.hookReason = plan.hookReason || fallback.hookReason;
  }
  plan.hookUnitIds = trimHook(plan.hookUnitIds, units, words, flagged, analysis.units);
  const hookSec = plan.hookUnitIds.reduce((sum, unitId) => sum + cleanedSeconds(units.get(unitId)!, words, flagged), 0);

  const unitMoment = new Map<string, string>();
  for (const moment of analysis.moments) for (const unitId of moment.unitIds) unitMoment.set(unitId, moment.id);
  const minMomentScore = percentile(
    analysis.moments.map((moment) => moment.score),
    0.4
  );
  plan = fitRuntime({ plan, moments: usable, runtimeOf, hookSec, unitMoment, minMomentScore });

  const order = orderedUnitIds(plan, analysis.moments, units, new Set());
  let loops = validLoops(plan.openLoops, order);
  if (loops.length < MIN_OPEN_LOOPS) {
    for (const loop of heuristicLoops(order.slice(plan.hookUnitIds.length), units)) {
      if (loops.length >= MIN_OPEN_LOOPS) break;
      if (!loops.some((existing) => existing.plantUnitId === loop.plantUnitId)) loops.push(loop);
    }
  }
  if (loops.length < MIN_OPEN_LOOPS && plan.hookUnitIds[0] && order.lastIndexOf(plan.hookUnitIds[0]) > 0) {
    loops.push({
      plantUnitId: plan.hookUnitIds[0],
      payoffUnitId: plan.hookUnitIds[0],
      question: "The cold open shows the moment out of context; the video earns it when the line comes back in place."
    });
  }
  loops = loops.slice(0, 4);
  plan = { ...plan, openLoops: loops };
  await writeJson(projectFile(id, "story.json"), plan);
  log(`story planned from ${plan.source}: ${plan.sections.length} sections, ${loops.length} open loops`);
  return plan;
}

async function alignedWords(id: string, words: Word[], units: Unit[], log: Log): Promise<Word[]> {
  const cacheFile = projectFile(id, "aligned.json");
  const doneFile = projectFile(id, "aligned-units.json");
  const cache = (await readJson<Record<string, [number, number, number]>>(cacheFile)) ?? {};
  const done = new Set((await readJson<string[]>(doneFile)) ?? []);
  const missing = units.filter((unit) => !done.has(unit.id));
  if (missing.length > 0) {
    const spans = missing.map((unit) => ({
      start: unit.start,
      end: unit.end,
      words: words.slice(unit.firstWord, unit.lastWord + 1).map((word, offset) => ({ i: unit.firstWord + offset, w: word.w }))
    }));
    const spansFile = projectFile(id, "align-spans.json");
    const outFile = projectFile(id, "align-out.json");
    await writeJson(spansFile, spans);
    const wav = projectFile(id, "audio16k.wav");
    const status = await readStatus(id);
    if (!(await exists(wav)) && status) await runProcess("ffmpeg", ["-v", "error", "-y", "-i", status.sourcePath, "-vn", "-ac", "1", "-ar", "16000", wav]);
    log(`force-aligning ${missing.length} units for exact word edges`);
    try {
      await runProcess(PYTHON, [script("align.py"), wav, spansFile, outFile]);
      Object.assign(cache, (await readJson<Record<string, [number, number, number]>>(outFile)) ?? {});
      for (const unit of missing) done.add(unit.id);
      await writeJson(cacheFile, cache);
      await writeJson(doneFile, [...done]);
    } catch (error) {
      log(`alignment unavailable, using transcript timings: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`);
    }
    await rm(spansFile, { force: true });
    await rm(outFile, { force: true });
  }
  return words.map((word, index) => {
    const hit = cache[String(index)];
    return hit && hit[1] > hit[0] ? { ...word, s: hit[0], e: hit[1] } : word;
  });
}

export type EditResult = {
  edl: Edl;
  chapters: Chapter[];
  srt: string;
  words: TimelineWord[];
  removals: { filler: number; stutter: number; falseStart: number; repeat: number; silence: number; seconds: number };
  sourceSelectedSec: number;
  sourceFillersInSelection: number;
};

function applyTakeChoices(units: Map<string, Unit>, choices: Record<string, string>): void {
  for (const [group, chosen] of Object.entries(choices)) {
    const members = [...units.values()].filter((unit) => unit.retakeGroup === group);
    if (!members.some((unit) => unit.id === chosen)) continue;
    for (const unit of members) unit.retakeOf = unit.id === chosen ? undefined : chosen;
  }
}

export async function editStage(id: string, log: Log): Promise<EditResult> {
  const analysis = await readJson<Analysis>(projectFile(id, "analysis.json"));
  const transcript = await readJson<Transcript>(projectFile(id, "transcript.json"));
  const storedPlan = await readJson<StoryPlan>(projectFile(id, "story.json"));
  const visual = await readJson<VisualTrack>(projectFile(id, "visual.json"));
  const status = await readStatus(id);
  if (!analysis || !transcript || !storedPlan || !status) throw new Error("Plan the story before building the edit.");
  const overrides = await readOverrides(id);
  const units = new Map(analysis.units.map((unit) => [unit.id, { ...unit }]));
  applyTakeChoices(units, overrides.takeChoices);
  const plan: StoryPlan = overrides.hookUnitIds?.length ? { ...storedPlan, hookUnitIds: overrides.hookUnitIds, source: storedPlan.source } : storedPlan;
  const disabled = new Set(overrides.disabledUnitIds);

  const sectionOf = new Map<string, SectionRole>();
  plan.sections.forEach((section) => {
    for (const momentId of section.momentIds) {
      for (const unitId of analysis.moments.find((moment) => moment.id === momentId)?.unitIds ?? []) sectionOf.set(unitId, section.role);
    }
  });
  const order = orderedUnitIds(plan, analysis.moments, units, disabled);
  const hookCount = plan.hookUnitIds.length;
  const keyUnits = new Set<string>([...plan.hookUnitIds, ...plan.openLoops.flatMap((loop) => [loop.plantUnitId, loop.payoffUnitId])]);
  const payoffSection = plan.sections.find((section) => section.role === "payoff");
  const payoffFirst = payoffSection ? analysis.moments.find((moment) => moment.id === payoffSection.momentIds[0])?.unitIds[0] : undefined;
  if (payoffFirst) keyUnits.add(payoffFirst);
  for (const section of plan.sections) {
    const opening = analysis.moments.find((moment) => moment.id === section.momentIds[0])?.unitIds.find((unitId) => !units.get(unitId)?.retakeOf);
    if (opening) keyUnits.add(opening);
  }

  const entries: EdlUnit[] = order.map((unitId, index) => {
    const unit = units.get(unitId)!;
    const isHook = index < hookCount;
    const next = order[index + 1];
    const section: SectionRole = isHook ? "hook" : sectionOf.get(unitId) ?? "development";
    const nextSection = next ? (index + 1 < hookCount ? "hook" : sectionOf.get(next)) : undefined;
    return {
      unit,
      section,
      key: keyUnits.has(unitId),
      dramatic: isHook ? index === hookCount - 1 : nextSection !== undefined && nextSection !== section,
      tag: isHook ? "hook" : undefined
    };
  });

  const samples = visual?.samples ?? [];
  const envelope = await loadEnvelope(id);
  const words = await alignedWords(id, transcript.words, [...new Set(order)].map((unitId) => units.get(unitId)!), log);
  const built = buildEdl({
    source: status.sourcePath,
    fps: 30,
    width: status.width ?? 1920,
    height: status.height ?? 1080,
    words,
    flags: analysis.flags,
    units: entries,
    envelope,
    hopSec: HOP_SEC,
    anchorFor: (start, end) => zoomAnchor(samplesIn(samples, start - 5, end + 5)),
    zoomOverrides: overrides.zoom
  });
  const retimed = retime(built.edl.segments);
  const edl: Edl = { ...built.edl, segments: retimed.segments, runtimeSec: retimed.runtimeSec };

  const momentOfUnit = new Map<string, string>();
  for (const moment of analysis.moments) for (const unitId of moment.unitIds) momentOfUnit.set(unitId, moment.id);
  const copy = await readJson<StoryCopy>(projectFile(id, "copy.json"));
  const chapters = chaptersFromTimeline(
    edl.segments,
    plan,
    momentOfUnit,
    (key, fallback) => copy?.chapterTitles?.[key]?.trim() || fallback,
    edl.runtimeSec
  );

  const tWords = timelineWords(edl.segments, words);
  const srt = buildSrt(tWords);
  const tally = { filler: 0, stutter: 0, falseStart: 0, repeat: 0, silence: 0, seconds: 0 };
  for (const removal of built.removals) {
    tally.seconds += removal.end - removal.start;
    if (removal.kind === "filler") tally.filler++;
    else if (removal.kind === "stutter") tally.stutter++;
    else if (removal.kind === "false-start") tally.falseStart++;
    else if (removal.kind === "repeat") tally.repeat++;
    else tally.silence++;
  }
  const bodyUnits = order.map((unitId) => units.get(unitId)!);
  const sourceSelectedSec = bodyUnits.reduce((sum, unit) => sum + (unit.end - unit.start), 0);
  const sourceFillersInSelection = bodyUnits.reduce((sum, unit) => sum + countFillers(words.slice(unit.firstWord, unit.lastWord + 1)), 0);

  await writeJson(packageFile(id, "edl.json"), edl);
  await writeJson(projectFile(id, "chapters.json"), chapters);
  await mkdir(packageFile(id), { recursive: true });
  await writeFile(packageFile(id, "captions.srt"), srt, "utf8");
  await writeJson(projectFile(id, "timeline-words.json"), tWords);
  const result: EditResult = { edl, chapters, srt, words: tWords, removals: tally, sourceSelectedSec, sourceFillersInSelection };
  await writeJson(projectFile(id, "edit.json"), { ...result, srt: undefined, words: undefined });
  log(`edit built: ${edl.segments.length} segments, ${formatClock(edl.runtimeSec)} runtime, ${chapters.length} chapters`);
  return result;
}

function fallbackCopy(plan: StoryPlan, title: string, chapterKeys: Array<{ key: string; summary: string }>): StoryCopy {
  const short = title.split(" - ")[0].slice(0, 55);
  return {
    titles: [
      { style: "curiosity", title: "What Happened When I Let AI Build All Day" },
      { style: "outcome", title: short.slice(0, 58) },
      { style: "contrarian", title: "Vibe Coding Is Harder Than It Looks" },
      { style: "number", title: "4 Hours of Vibe Coding in 10 Minutes" },
      { style: "direct", title: "Building My App Live With AI Agents" }
    ],
    recommended: 0,
    recommendedReason: "Offline fallback: the curiosity title matches the cold open.",
    hookSentence: plan.hookReason || "One day of building in public, cut down to the moments that mattered.",
    arc: plan.sections.map((section) => section.reason).filter(Boolean).join(" ").slice(0, 600),
    takeaways: plan.sections.slice(0, 4).map((section) => section.title),
    hashtags: ["#vibecoding", "#buildinpublic", "#ai"],
    tags: ["vibe coding", "build in public", "AI agents", "Claude", "coding"],
    chapterTitles: Object.fromEntries(chapterKeys.map((chapter) => [chapter.key, chapter.summary.split(":")[0]])),
    thumbnails: [
      { emotion: "shocked, eyes wide", frame: "the cold open line", overlay: "IT ACTUALLY WORKED", layout: "face right, screen left", colors: "yellow text on dark blue" },
      { emotion: "focused, leaning in", frame: "mid-build at the desk", overlay: "DAY 61", layout: "big number left, face right", colors: "white on red" },
      { emotion: "grinning", frame: "the payoff moment", overlay: "$3,146", layout: "revenue number centred", colors: "green on black" }
    ]
  };
}

export async function copyStage(id: string, log: Log): Promise<StoryCopy> {
  const plan = await readJson<StoryPlan>(projectFile(id, "story.json"));
  const analysis = await readJson<Analysis>(projectFile(id, "analysis.json"));
  const status = await readStatus(id);
  const tWords = await readJson<TimelineWord[]>(projectFile(id, "timeline-words.json"));
  if (!plan || !analysis || !status || !tWords) throw new Error("Build the edit before writing the packaging.");
  const units = new Map(analysis.units.map((unit) => [unit.id, unit]));
  const moments = new Map(analysis.moments.map((moment) => [moment.id, moment]));
  const hookText = plan.hookUnitIds.map((unitId) => units.get(unitId)?.text ?? "").join(" ");
  const chapterKeys = [
    { key: "hook", summary: `cold open: ${hookText.slice(0, 160)}` },
    ...plan.sections.map((section, index) => ({
      key: `s${index}`,
      summary: `${section.role} (${section.title}): ${(moments.get(section.momentIds[0])?.text ?? "").slice(0, 200)}`
    }))
  ];
  const outline = [
    `Cold open: "${hookText}"`,
    ...plan.sections.map(
      (section, index) =>
        `s${index} ${section.role} "${section.title}": ${section.momentIds.map((momentId) => moments.get(momentId)?.text ?? "").join(" ").slice(0, 900)}`
    )
  ].join("\n");
  log("writing titles, description and thumbnail concepts");
  let copy = await askCopy({ title: status.title, outline, chapterKeys, transcript: tWords.map((word) => word.w).join(" ") }).catch(() => null);
  if (!copy || validateTitles(copy.titles).some((problem) => problem.startsWith("needs"))) {
    log("copywriter unavailable, using offline packaging");
    copy = fallbackCopy(plan, status.title, chapterKeys);
  }
  copy.titles = copy.titles.map((option) => ({ ...option, title: fitTitle(option.title) }));
  await writeJson(projectFile(id, "copy.json"), copy);
  return copy;
}

export function fitTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean.length < TITLE_MAX_CHARS) return clean;
  const words = clean.split(" ");
  while (words.length > 1 && words.join(" ").length >= TITLE_MAX_CHARS) words.pop();
  return words.join(" ").replace(/[,:;\-–—]$/, "");
}

export function storyOutline(plan: StoryPlan, analysis: Analysis, edl: Edl | null): string {
  const units = new Map(analysis.units.map((unit) => [unit.id, unit]));
  const moments = new Map(analysis.moments.map((moment) => [moment.id, moment]));
  const at = (unitIds: string[], prefix?: string) => {
    if (!edl) return "";
    const segment = edl.segments.find(
      (entry) => entry.enabled && unitIds.includes(entry.unitId) && (prefix ? entry.id.startsWith(prefix) : !entry.id.startsWith("hook-"))
    );
    return segment ? `[${chapterClock(segment.timelineIn)}] ` : "";
  };
  const lines = [
    `1. ${at(plan.hookUnitIds, "hook-")}HOOK (cold open, from ${formatClock(units.get(plan.hookUnitIds[0])?.start ?? 0)} of the stream): "${plan.hookUnitIds
      .map((unitId) => units.get(unitId)?.text)
      .join(" ")}" - ${plan.hookReason}`
  ];
  let n = 2;
  for (const role of SECTION_ORDER.slice(1)) {
    for (const section of plan.sections.filter((entry) => entry.role === role)) {
      const unitIds = section.momentIds.flatMap((momentId) => moments.get(momentId)?.unitIds ?? []);
      const sources = section.momentIds.map((momentId) => formatClock(moments.get(momentId)?.start ?? 0)).join(", ");
      const kept = (moments.get(section.momentIds[0])?.text ?? "").split(/\s+/).slice(0, 28).join(" ");
      lines.push(`${n++}. ${at(unitIds)}${role.toUpperCase()} - ${section.title} (source ${sources}): ${section.reason} Opens on: "${kept}..."`);
    }
  }
  if (plan.openLoops.length) {
    lines.push("", "Open loops:");
    for (const loop of plan.openLoops) {
      lines.push(`- ${at([loop.plantUnitId])}planted "${units.get(loop.plantUnitId)?.text.slice(0, 90)}" -> paid off ${at([loop.payoffUnitId])}"${units.get(loop.payoffUnitId)?.text.slice(0, 90)}" (${loop.question})`);
    }
  }
  return lines.join("\n");
}

export async function renderStage(id: string, log: Log): Promise<void> {
  const edl = await readJson<Edl>(packageFile(id, "edl.json"));
  const status = await readStatus(id);
  if (!edl || !status) throw new Error("Build the edit before rendering.");
  const result = await renderEdl({
    edl,
    sourcePath: status.sourcePath,
    sourceDurationSec: status.durationSec || (await sourceDuration(status.sourcePath)),
    workDir: projectFile(id, "render"),
    outPath: packageFile(id, "final.mp4"),
    log
  });
  await writeJson(projectFile(id, "render.json"), { ...result, renderedAt: new Date().toISOString() });
  await rm(projectFile(id, "render"), { recursive: true, force: true });
}

export type Verification = {
  runtimeSec: number;
  runtimeOk: boolean;
  hookWithin30s: boolean;
  fillersInSelection: number;
  fillersAfterRender: number;
  fillerRemovalPct: number;
  fillersHeardRaw: number;
  fillerRemovalRawPct: number;
  audibleFillers: Array<{ at: number; context: string }>;
  captionDriftMs: number;
  loudness: { integrated: number; truePeak: number };
  loudnessOk: boolean;
  chapterChecks: Array<{ title: string; seconds: number; expected: string; heard: string; lands: boolean }>;
  chaptersValid: { ok: boolean; problems: string[] };
  everySegmentScored: boolean;
  onlyAllowedTransitions: boolean;
  cutFrames: string[];
};

export function fillerHits(words: Word[]): Array<{ s: number; e: number; context: string }> {
  return fillerIndices(words).map((i) => ({
    s: words[i].s,
    e: words[i].e,
    context: words.slice(Math.max(0, i - 3), i + 4).map((word) => word.w).join(" ")
  }));
}

export function voicedSeconds(envelope: Float32Array, hopSec: number, start: number, end: number): number {
  const threshold = silenceThreshold(envelope, hopSec, (start + end) / 2);
  let voiced = 0;
  for (let k = Math.max(0, Math.floor(start / hopSec)); k < Math.min(envelope.length, Math.ceil(end / hopSec)); k++) {
    if (envelope[k] > threshold) voiced += hopSec;
  }
  return voiced;
}

async function alignRender(id: string, wav: string, words: Word[], segments: Array<{ s: number; e: number }>): Promise<Word[]> {
  const spans = segments
    .map((segment) => ({
      start: segment.s,
      end: segment.e,
      words: words.map((word, i) => ({ i, w: word.w, s: word.s })).filter((word) => word.s >= segment.s - 0.05 && word.s < segment.e)
    }))
    .filter((span) => span.words.length > 0);
  const spansFile = projectFile(id, "final-align-spans.json");
  const outFile = projectFile(id, "final-aligned.json");
  await writeJson(spansFile, spans);
  try {
    await runProcess(PYTHON, [script("align.py"), wav, spansFile, outFile]);
  } catch {
    return words;
  } finally {
    await rm(spansFile, { force: true });
  }
  const aligned = (await readJson<Record<string, [number, number, number]>>(outFile)) ?? {};
  return words.map((word, index) => {
    const hit = aligned[String(index)];
    return hit && hit[1] > hit[0] ? { ...word, s: hit[0], e: hit[1] } : word;
  });
}

export async function verifyStage(id: string, log: Log): Promise<Verification> {
  const edl = await readJson<Edl>(packageFile(id, "edl.json"));
  const edit = await readJson<Omit<EditResult, "srt" | "words">>(projectFile(id, "edit.json"));
  const tWords = (await readJson<TimelineWord[]>(projectFile(id, "timeline-words.json"))) ?? [];
  const chapters = (await readJson<Chapter[]>(projectFile(id, "chapters.json"))) ?? [];
  if (!edl || !edit) throw new Error("Render before verifying.");
  const final = packageFile(id, "final.mp4");
  const wav = projectFile(id, "final16k.wav");
  log("re-transcribing the render");
  await runProcess("ffmpeg", ["-v", "error", "-y", "-i", final, "-vn", "-ac", "1", "-ar", "16000", wav]);
  await runProcess(PYTHON, [script("transcribe.py"), wav, projectFile(id, "final-transcript.json")]);
  await runProcess(PYTHON, [script("envelope.py"), wav, projectFile(id, "final-envelope.f32")]);
  const heardRaw = (await readJson<Transcript & { segments?: Array<{ s: number; e: number }> }>(projectFile(id, "final-transcript.json"))) ?? { words: [], durationSec: 0 };
  const heard = await alignRender(id, wav, heardRaw.words, heardRaw.segments ?? []);
  await rm(wav, { force: true });
  const renderEnvelope = await readFile(projectFile(id, "final-envelope.f32")).then(
    (buffer) => new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4)),
    () => null
  );
  const heardFillers = fillerHits(heard);
  const audible = heardFillers.filter((hit) => !renderEnvelope || voicedSeconds(renderEnvelope, HOP_SEC, hit.s, hit.e) >= 0.1);
  const fillersAfter = audible.length;
  const before = Math.max(1, edit.sourceFillersInSelection);

  const drifts: number[] = [];
  let cursor = 0;
  for (const word of tWords) {
    const target = norm(word.w);
    if (target.length < 4) continue;
    for (let k = cursor; k < Math.min(heard.length, cursor + 12); k++) {
      if (norm(heard[k].w) === target && Math.abs(heard[k].s - word.s) < 1.5) {
        drifts.push(Math.abs(heard[k].s - word.s) * 1000);
        cursor = k + 1;
        break;
      }
    }
  }
  drifts.sort((a, b) => a - b);

  const window = (list: Array<{ w: string; s: number }>, from: number) =>
    list.filter((word) => word.s >= from - 0.2 && word.s < from + 6).map((word) => word.w).join(" ");
  const chapterChecks = chapters.map((chapter) => {
    const expected = window(tWords, chapter.seconds);
    const got = window(heard, chapter.seconds);
    const a = contentTokens(expected);
    const b = new Set(contentTokens(got));
    const overlap = a.length ? a.filter((token) => b.has(token)).length / a.length : 0;
    return { title: chapter.title, seconds: chapter.seconds, expected, heard: got, lands: overlap >= 0.4 };
  });

  const loudness = await measureLoudness(final);
  const cutFrames: string[] = [];
  const cuts = edl.segments.filter((segment) => segment.enabled && segment.timelineIn > 0);
  const picks = Array.from({ length: Math.min(10, cuts.length) }, (_, k) => cuts[Math.floor(((k + 0.5) * cuts.length) / Math.min(10, cuts.length))]);
  await rm(projectFile(id, "cut-checks"), { recursive: true, force: true });
  await mkdir(projectFile(id, "cut-checks"), { recursive: true });
  for (const [k, segment] of picks.entries()) {
    const file = projectFile(id, "cut-checks", `cut-${String(k + 1).padStart(2, "0")}-${segment.id}.jpg`);
    await runProcess("ffmpeg", ["-v", "error", "-y", "-ss", (segment.timelineIn + 0.1).toFixed(3), "-i", final, "-frames:v", "1", "-vf", "scale=960:-2", file]);
    cutFrames.push(path.basename(file));
  }

  const verification: Verification = {
    runtimeSec: edl.runtimeSec,
    runtimeOk: edl.runtimeSec >= TARGET_MIN_SEC && edl.runtimeSec <= TARGET_MAX_SEC,
    hookWithin30s: edl.segments.some((segment) => segment.section === "hook" && segment.timelineOut <= 30.5),
    fillersInSelection: edit.sourceFillersInSelection,
    fillersAfterRender: fillersAfter,
    fillerRemovalPct: Math.round((1 - fillersAfter / before) * 1000) / 10,
    fillersHeardRaw: heardFillers.length,
    fillerRemovalRawPct: Math.round((1 - heardFillers.length / before) * 1000) / 10,
    audibleFillers: audible.map((hit) => ({ at: Math.round(hit.s * 100) / 100, context: hit.context })),
    captionDriftMs: Math.round(drifts[Math.floor(drifts.length / 2)] ?? 0),
    loudness,
    loudnessOk: Math.abs(loudness.integrated - LOUDNESS_TARGET.integrated) <= 1 && loudness.truePeak <= -1,
    chapterChecks,
    chaptersValid: validateChapters(chapters, edl.runtimeSec),
    everySegmentScored: edl.segments.every((segment) => Number.isFinite(segment.audioScore) && Number.isFinite(segment.visualScore) && segment.reason.length > 0),
    onlyAllowedTransitions: edl.segments.every((segment) => ["cut", "jump", "j-cut", "l-cut"].includes(segment.transition)),
    cutFrames
  };
  await writeJson(projectFile(id, "verification.json"), verification);
  log(`verified: ${verification.fillerRemovalPct}% fillers removed, drift ${verification.captionDriftMs} ms, ${loudness.integrated} LUFS`);
  return verification;
}

export async function framesStage(id: string, log: Log): Promise<Array<{ file: string; seconds: number; reason: string }>> {
  const edl = await readJson<Edl>(packageFile(id, "edl.json"));
  const visual = await readJson<VisualTrack>(projectFile(id, "visual.json"));
  const status = await readStatus(id);
  if (!edl || !visual || !status) throw new Error("Build the edit before picking frames.");
  const candidates: Array<{ sample: VisualSample; score: number; segmentId: string }> = [];
  const maxGesture = Math.max(0.01, percentile(visual.samples.filter((s) => s.face).map((s) => s.face!.gesture), 0.95));
  const maxSharp = Math.max(1, percentile(visual.samples.filter((s) => s.face).map((s) => s.face!.sharp), 0.95));
  for (const segment of edl.segments.filter((entry) => entry.enabled)) {
    for (const sample of samplesIn(visual.samples, segment.in, segment.out)) {
      if (!sample.face) continue;
      const score =
        sample.face.front * 0.35 +
        Math.min(1, sample.face.sharp / maxSharp) * 0.25 +
        Math.min(1, sample.face.gesture / maxGesture) * 0.2 +
        segment.scores.emotion * 0.1 +
        segment.scores.delivery * 0.1;
      candidates.push({ sample, score, segmentId: segment.id });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const picked: typeof candidates = [];
  for (const candidate of candidates) {
    if (picked.length >= 10) break;
    if (picked.some((entry) => Math.abs(entry.sample.t - candidate.sample.t) < 45)) continue;
    picked.push(candidate);
  }
  const dir = packageFile(id, "thumbnail-frames");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const frames: Array<{ file: string; seconds: number; reason: string }> = [];
  for (const [k, entry] of picked.entries()) {
    const file = `frame-${String(k + 1).padStart(2, "0")}-${formatClock(entry.sample.t).replace(/:/g, "")}.png`;
    await runProcess("ffmpeg", [
      "-v", "error", "-y", "-ss", entry.sample.t.toFixed(2), "-i", status.sourcePath,
      "-frames:v", "1", "-vf", "scale=1280:720:flags=lanczos", path.join(dir, file)
    ]);
    const face = entry.sample.face!;
    frames.push({
      file,
      seconds: entry.sample.t,
      reason: `eye contact ${face.front.toFixed(2)}, face sharpness ${Math.round(face.sharp)}, gesture ${face.gesture.toFixed(1)} (segment ${entry.segmentId})`
    });
  }
  await writeJson(projectFile(id, "frames.json"), frames);
  log(`${frames.length} thumbnail frames exported`);
  return frames;
}

export async function packageStage(id: string, log: Log): Promise<void> {
  const status = await readStatus(id);
  const plan = await readJson<StoryPlan>(projectFile(id, "story.json"));
  const analysis = await readJson<Analysis>(projectFile(id, "analysis.json"));
  const edl = await readJson<Edl>(packageFile(id, "edl.json"));
  const edit = await readJson<Omit<EditResult, "srt" | "words">>(projectFile(id, "edit.json"));
  const chapters = (await readJson<Chapter[]>(projectFile(id, "chapters.json"))) ?? [];
  const copy = await readJson<StoryCopy>(projectFile(id, "copy.json"));
  const verification = await readJson<Verification>(projectFile(id, "verification.json"));
  const frames = (await readJson<Array<{ file: string; seconds: number; reason: string }>>(projectFile(id, "frames.json"))) ?? [];
  const youtube = await readJson<Record<string, unknown>>(packageFile(id, "youtube.json"));
  if (!status || !plan || !analysis || !edl || !edit || !copy) throw new Error("Nothing to package yet.");

  const description = buildDescription(copy, chapters);
  const recommended = copy.titles[copy.recommended]?.title ?? copy.titles[0]?.title ?? status.title;
  await writeFile(packageFile(id, "titles.md"), titlesMarkdown(copy), "utf8");
  await writeFile(packageFile(id, "thumbnails.md"), thumbnailsMarkdown(copy.thumbnails, frames), "utf8");
  await writeFile(packageFile(id, "description.txt"), description, "utf8");
  await writeJson(packageFile(id, "youtube.json"), {
    ...(youtube ?? {}),
    privacyStatus: "private",
    title: draftTitle(recommended),
    description,
    chapters: chapters.map((chapter) => ({ time: chapterClock(chapter.seconds), seconds: chapter.seconds, title: chapter.title })),
    tags: copy.tags,
    categoryId: "28",
    language: "en",
    selfDeclaredMadeForKids: false
  });

  const units = new Map(analysis.units.map((unit) => [unit.id, unit]));
  const hookUnit = units.get(plan.hookUnitIds[0]);
  const report = [
    `# Edit report - ${status.title}`,
    "",
    `- Source: ${formatClock(status.durationSec)} (${status.sourceUrl ?? status.sourcePath})`,
    `- Final runtime: **${formatClock(edl.runtimeSec)}** (target 8:00-12:00, aim 10:00)${edl.runtimeSec < TARGET_MIN_SEC || edl.runtimeSec > TARGET_MAX_SEC ? " - OUTSIDE TARGET, see below" : ""}`,
    plan.shortfall ? `- Runtime shortfall: ${plan.shortfall}` : "",
    `- Segments: ${edl.segments.filter((segment) => segment.enabled).length} (${edl.segments.filter((s) => s.transition === "jump").length} jump cuts, ${edl.segments.filter((s) => s.transition === "j-cut").length} J-cuts, ${edl.segments.filter((s) => s.zoomTo > s.zoom).length} push-ins, ${edl.segments.filter((s) => s.zoom > 1 && s.zoomTo === s.zoom).length} punch-ins)`,
    `- Removed inside the kept story: ${edit.removals.filler} fillers, ${edit.removals.stutter} stutters, ${edit.removals.falseStart} false-start words, ${edit.removals.repeat} repeated words, ${edit.removals.silence} long pauses tightened (${Math.round(edit.removals.seconds)} s)`,
    `- Time removed overall: ${formatClock(status.durationSec - edl.runtimeSec)} of ${formatClock(status.durationSec)}`,
    `- Retakes found: ${analysis.retakeGroups.length} groups; the best take by combined audio + visual score is kept`,
    `- Story planned by: ${plan.source === "ai" ? "the AI story editor, then fitted to runtime" : plan.source}`,
    "",
    "## Hook",
    "",
    `"${plan.hookUnitIds.map((unitId) => units.get(unitId)?.text).join(" ")}"`,
    "",
    `Lifted from ${formatClock(hookUnit?.start ?? 0)} of the stream and played as a cold open at 00:00. ${plan.hookReason}`,
    hookUnit ? `Scores: story ${hookUnit.scores.story}, delivery ${hookUnit.scores.delivery}, visual ${hookUnit.scores.visual}, combined ${hookUnit.scores.combined}.` : "",
    "",
    "## Story outline",
    "",
    storyOutline(plan, analysis, edl),
    "",
    "## Chapters",
    "",
    chapterBlock(chapters),
    "",
    verification
      ? [
          "## Verification",
          "",
          `- Runtime in range: ${verification.runtimeOk ? "yes" : "no"}`,
          `- Hook inside the first 30 s: ${verification.hookWithin30s ? "yes" : "no"}`,
          `- Filler removal (re-transcription of the render): ${verification.fillerRemovalPct}% counting fillers with audible voice under them (${verification.fillersInSelection} in the selected source, ${verification.fillersAfterRender} audible in the render); ${verification.fillerRemovalRawPct}% if every filler Whisper reports is counted (${verification.fillersHeardRaw}, most of the gap is Whisper writing "um" at hard cuts where the audio is silent)`,
          `- Caption drift (median, render vs SRT): ${verification.captionDriftMs} ms`,
          `- Loudness: ${verification.loudness.integrated} LUFS integrated, ${verification.loudness.truePeak} dBFS peak (${verification.loudnessOk ? "within" : "OUTSIDE"} +/-1 LU of -14, peak <= -1)`,
          `- Chapters valid for YouTube: ${verification.chaptersValid.ok ? "yes" : verification.chaptersValid.problems.join("; ")}`,
          `- Chapters land on their section after render: ${verification.chapterChecks.filter((check) => check.lands).length}/${verification.chapterChecks.length}`,
          `- Every EDL segment carries audio + visual scores and a reason: ${verification.everySegmentScored ? "yes" : "no"}`,
          `- Edit language limited to cuts, jump cuts, J-cuts, punch-ins and push-ins: ${verification.onlyAllowedTransitions ? "yes" : "no"}`,
          "- Cuts are placed between words (word-boundary ranges snapped to the quietest 10 ms inside the gap) with 15 ms crossfades at every join",
          `- Frames at 10 cuts: ${verification.cutFrames.map((file) => `cut-checks/${file}`).join(", ")}`
        ].join("\n")
      : "",
    "",
    "## Zoom",
    "",
    "Punch-ins and push-ins are centred on the whole frame. The tracked face is only used as the zoom centre when it fills a talking-head share of the frame; a small corner facecam is never zoomed into, because that is an upscale of a few hundred pixels."
  ]
    .filter((line) => line !== undefined)
    .join("\n");
  await writeFile(packageFile(id, "edit-report.md"), report, "utf8");
  log("publish package written");
}

export async function uploadStage(id: string, log: Log, accessToken: () => Promise<string>): Promise<Record<string, unknown>> {
  const youtube = await readJson<Record<string, unknown> & { title: string; description: string; tags: string[]; resumeUrl?: string }>(packageFile(id, "youtube.json"));
  if (!youtube) throw new Error("Package the video before uploading.");
  const file = packageFile(id, "final.mp4");
  const metadata = { title: youtube.title, description: youtube.description, tags: youtube.tags, categoryId: "28", language: "en", madeForKids: false };
  storyVideoBody(metadata);
  log("uploading to YouTube as private");
  let lastLogged = 0;
  const { videoId } = await uploadStoryVideo({
    ...metadata,
    file,
    accessToken,
    resumeUrl: youtube.resumeUrl,
    onSession: (url) => writeJson(packageFile(id, "youtube.json"), { ...youtube, resumeUrl: url }),
    onProgress: (sent, total) => {
      const pct = Math.floor((sent / total) * 100);
      if (pct - lastLogged >= 20) {
        lastLogged = pct;
        log(`uploaded ${pct}%`);
      }
    }
  });
  let captionId: string | null = null;
  try {
    captionId = await uploadCaptions({ videoId, srt: await readFile(packageFile(id, "captions.srt"), "utf8"), language: "en", name: "English", accessToken });
  } catch (error) {
    log(`caption upload failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const readback = await readBackVideo(videoId, accessToken);
  verifyPrivate(readback);
  const result = {
    ...youtube,
    resumeUrl: undefined,
    videoId,
    studioLink: studioLink(videoId),
    watchLink: `https://youtu.be/${videoId}`,
    privacyStatus: readback.privacyStatus,
    verifiedPrivateAt: new Date().toISOString(),
    captionTrackId: captionId,
    readback: { title: readback.title, privacyStatus: readback.privacyStatus, processingStatus: readback.processingStatus }
  };
  await writeJson(packageFile(id, "youtube.json"), result);
  log(`uploaded ${videoId}; YouTube reports it as ${readback.privacyStatus}`);
  return result;
}

export const STAGES: StoryStage[] = ["analyze", "score", "story", "edit", "copy", "render", "verify", "frames", "package"];

export async function runStages(
  id: string,
  stages: StoryStage[],
  options: { accessToken?: () => Promise<string>; log?: Log } = {}
): Promise<void> {
  const log: Log = (message) => {
    options.log?.(message);
    void updateStatus(id, {}, message);
  };
  await updateStatus(id, { busy: true, error: undefined });
  try {
    for (const stage of stages) {
      await updateStatus(id, { stage });
      if (stage === "analyze") await analyzeStage(id, log);
      else if (stage === "score") await scoreStage(id, log);
      else if (stage === "story") await storyStage(id, log);
      else if (stage === "edit") await editStage(id, log);
      else if (stage === "copy") {
        await copyStage(id, log);
        await editStage(id, log);
      } else if (stage === "render") await renderStage(id, log);
      else if (stage === "verify") await verifyStage(id, log);
      else if (stage === "frames") await framesStage(id, log);
      else if (stage === "package") await packageStage(id, log);
      else if (stage === "upload") {
        if (!options.accessToken) throw new Error("No YouTube access token available for the upload.");
        await uploadStage(id, log, options.accessToken);
      }
    }
    await updateStatus(id, { busy: false, stage: "done" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateStatus(id, { busy: false, stage: "error", error: message }, `failed: ${message}`);
    throw error;
  }
}
