import { describe, expect, it } from "vitest";
import {
  applyViralityVerdicts,
  matchLineTime,
  recutToHook,
  buildViralityPrompt,
  parseViralityVerdicts,
  type ViralityRequest
} from "@/lib/clipping/virality";
import type { ClipCandidate } from "@/lib/clipping/types";

function candidate(id: string, score: number, rationale = "base"): ClipCandidate {
  return {
    id,
    start: 0,
    end: 20,
    score,
    breakdown: { hook: score, pacing: score, standalone: score, intensity: score },
    rationale
  };
}

describe("virality prompt", () => {
  it("lists every clip with its id and current score, and weaves the topic in", () => {
    const clips: ViralityRequest[] = [
      { id: "clip-1", transcript: "a story about shipping fast", score: 70 },
      { id: "clip-2", transcript: "a hot take on AI agents", score: 55 }
    ];
    const prompt = buildViralityPrompt(clips, "AI agents");
    expect(prompt).toContain("focused on: AI agents");
    expect(prompt).toContain("Clip clip-1 (current score 70)");
    expect(prompt).toContain("Clip clip-2 (current score 55)");
    expect(prompt).toContain('"verdict"');
  });
});

describe("parseViralityVerdicts", () => {
  it("reads a fenced JSON array and clamps values", () => {
    const text =
      "```json\n[" +
      '{"id":"clip-1","virality":150,"verdict":"keep","reason":"great hook","hook":"You wont believe"},' +
      '{"id":"clip-2","virality":-5,"verdict":"cut"}' +
      "]\n```";
    const verdicts = parseViralityVerdicts(text);
    expect(verdicts.get("clip-1")).toMatchObject({ virality: 100, verdict: "keep", hook: "You wont believe" });
    expect(verdicts.get("clip-2")).toMatchObject({ virality: 0, verdict: "cut" });
  });

  it("returns an empty map for an unparseable reply", () => {
    expect(parseViralityVerdicts("no json here").size).toBe(0);
  });
});

describe("applyViralityVerdicts", () => {
  it("re-ranks by blended score, sinks cuts, re-ids, and enriches the rationale", () => {
    const candidates = [candidate("clip-1", 80), candidate("clip-2", 60)];
    const verdicts = parseViralityVerdicts(
      '[{"id":"clip-1","virality":10,"verdict":"cut","reason":"boring"},' +
        '{"id":"clip-2","virality":95,"verdict":"keep","reason":"banger","hook":"Watch this"}]'
    );
    const ranked = applyViralityVerdicts(candidates, verdicts);
    // clip-2 (95) should now outrank the cut clip-1 and be re-labelled clip-1.
    expect(ranked[0].rationale).toContain("banger");
    expect(ranked[0].rationale).toContain('Stronger hook: "Watch this"');
    expect(ranked[0].id).toBe("clip-1");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("returns candidates untouched when there are no verdicts", () => {
    const candidates = [candidate("clip-1", 80)];
    expect(applyViralityVerdicts(candidates, new Map())).toBe(candidates);
  });
});

describe("opening on the hook", () => {
  it("re-cuts a clip to start on the line the judge picked", () => {
    const clip = { ...candidate("clip-1", 60), start: 100, end: 130 };
    const verdicts = parseViralityVerdicts('[{"id":"clip-1","virality":80,"verdict":"keep","openAt":104.2}]');
    const [out] = applyViralityVerdicts([clip], verdicts, { minDuration: 15 });
    expect(out.start).toBe(104.2);
    expect(out.end).toBe(130);
    expect(out.rationale).toContain("Re-cut to open on its hook");
  });

  it("never leaves a clip shorter than the minimum or moves it earlier", () => {
    expect(recutToHook({ ...candidate("a", 1), start: 100, end: 120 }, 108, 15).start).toBe(100);
    expect(recutToHook({ ...candidate("a", 1), start: 100, end: 120 }, 95, 15).start).toBe(100);
    expect(recutToHook({ ...candidate("a", 1), start: 100, end: 120 }, 100.2, 15).start).toBe(100);
  });

  it("only trusts a time that is one of the clip's own lines", () => {
    const lines = [{ at: 100, text: "so okay" }, { at: 103.5, text: "GPT just cut limits in half" }];
    expect(matchLineTime(103.6, lines)).toBe(103.5);
    expect(matchLineTime(110, lines)).toBeUndefined();
    expect(matchLineTime(undefined, lines)).toBeUndefined();
  });

  it("shows timed lines to the judge when it has them", () => {
    const prompt = buildViralityPrompt([
      { id: "clip-1", transcript: "x", score: 50, lines: [{ at: 12, text: "so anyway" }, { at: 15.5, text: "this cost me $20" }] }
    ]);
    expect(prompt).toContain("[15.5] this cost me $20");
    expect(prompt).toContain('"openAt"');
  });

  it("reads a null openAt as keep the start", () => {
    const verdicts = parseViralityVerdicts('[{"id":"clip-1","virality":80,"verdict":"keep","openAt":null}]');
    expect(verdicts.get("clip-1")!.openAt).toBeUndefined();
  });
});
