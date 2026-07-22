import { describe, expect, it } from "vitest";
import {
  applyViralityVerdicts,
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
