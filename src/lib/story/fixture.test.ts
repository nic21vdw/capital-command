import { describe, expect, it } from "vitest";
import { cleanRange, countFillers, detectDisfluencies } from "@/lib/story/cleanup";
import { buildEdl, timelineWords } from "@/lib/story/edl";
import { combineScores, heuristicStory } from "@/lib/story/scoring";
import { buildMoments, fitRuntime, heuristicPlan, orderedUnitIds, TARGET_MAX_SEC, TARGET_MIN_SEC } from "@/lib/story/story";
import type { Unit, Word } from "@/lib/story/types";
import { splitUnits } from "@/lib/story/units";

const FILLER_LINES = [
  "so um we are going to set up the project today",
  "uh the build is running and I am waiting on it",
  "okay so, like, this part is just installing packages",
  "you know, the terminal is scrolling and nothing much is happening",
  "I I think the tests are still going on this one"
];
const STRONG = "holy crap it finally worked and the app just made three thousand dollars in revenue overnight!";

function fixture(): Word[] {
  const words: Word[] = [];
  let t = 0;
  let line = 0;
  while (t < 25 * 60) {
    const text = t > 12 * 60 && t < 12 * 60 + 20 ? STRONG : `${FILLER_LINES[line++ % FILLER_LINES.length]} number ${line}.`;
    for (const w of text.split(" ")) {
      words.push({ w, s: t, e: t + 0.28 });
      t += 0.33;
    }
    t += 0.9;
  }
  return words;
}

describe("fixture: 25 minute talk with fillers and one strong mid-video moment", () => {
  const words = fixture();
  const flags = detectDisfluencies(words);
  const flagged = new Map(flags.map((flag) => [flag.index, flag.kind]));
  const raw = splitUnits(words);
  const units: Unit[] = raw.map((unit) => {
    const story = heuristicStory(unit.text, () => (unit.text.includes("revenue") ? 0.9 : 0.2));
    const energy = unit.text === STRONG ? 0.95 : 0.4;
    const scores = combineScores({ story: story.story, clarity: 0.8, emotion: story.emotion, visual: 0.6, delivery: energy, novelty: story.novelty });
    return {
      ...unit,
      audio: { clarity: 0.8, energy, paceWpm: 170, fillerRate: 0 },
      visual: { sharpness: 0.6, exposure: 0.7, framing: 0.8, eyeContact: 0.7, motion: 0.5, gesture: 0.4, variety: 0.2, unusable: [] },
      scores,
      reason: "fixture"
    };
  });
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const moments = buildMoments(units);

  it("opens on the strong mid-video moment", () => {
    const plan = heuristicPlan(moments, units);
    expect(byId.get(plan.hookUnitIds[0])?.text).toBe(STRONG);
    expect(byId.get(plan.hookUnitIds[0])!.start).toBeGreaterThan(12 * 60);
  });

  it("lands the runtime inside 8 to 12 minutes and strips the fillers", () => {
    const runtimeOf = (id: string) =>
      (moments.find((moment) => moment.id === id)?.unitIds ?? [])
        .map((unitId) => byId.get(unitId)!)
        .reduce((sum, unit) => sum + cleanRange(words, unit.firstWord, unit.lastWord, flagged).ranges.reduce((s, r) => s + r.end - r.start, 0), 0);
    const base = heuristicPlan(moments, units);
    const plan = fitRuntime({ plan: base, moments, runtimeOf, hookSec: 8, unitMoment: new Map(), minMomentScore: 0 });
    const order = orderedUnitIds(plan, moments, byId, new Set());
    const { edl } = buildEdl({
      source: "fixture.mp4",
      fps: 30,
      width: 1920,
      height: 1080,
      words,
      flags,
      units: order.map((unitId, index) => ({ unit: byId.get(unitId)!, section: index === 0 ? "hook" : "development", key: false, dramatic: false, tag: index === 0 ? "hook" : undefined })),
      envelope: null,
      hopSec: 0.01,
      anchorFor: () => ({ x: 0.5, y: 0.5, source: "frame" })
    });
    expect(edl.runtimeSec).toBeGreaterThanOrEqual(TARGET_MIN_SEC);
    expect(edl.runtimeSec).toBeLessThanOrEqual(TARGET_MAX_SEC);
    expect(edl.segments[0].section).toBe("hook");
    expect(edl.segments[0].timelineOut).toBeLessThanOrEqual(30);

    const selected = order.slice(1).map((unitId) => byId.get(unitId)!);
    const before = selected.reduce((sum, unit) => sum + countFillers(words.slice(unit.firstWord, unit.lastWord + 1)), 0);
    const after = countFillers(timelineWords(edl.segments, words).map((word) => ({ ...word })));
    expect(before).toBeGreaterThan(20);
    expect(1 - after / before).toBeGreaterThanOrEqual(0.95);
  });
});
