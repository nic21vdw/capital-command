import { describe, expect, it } from "vitest";
import { planSfxCues } from "@/lib/sfx/cues";
import { defaultSfxSettings } from "@/lib/sfx/types";
import type { CaptionSegment, SfxSettings } from "@/types/domain";

/** Builds a caption segment with evenly spaced word timing from `start`. */
function seg(id: string, text: string, start: number): CaptionSegment {
  const tokens = text.split(/\s+/);
  const step = 0.35;
  const words = tokens.map((token, index) => ({
    text: token,
    start: start + index * step,
    end: start + index * step + 0.3
  }));
  return { id, start, end: words[words.length - 1].end, text, words, enabled: true };
}

function settings(partial: Partial<SfxSettings> = {}): SfxSettings {
  return { ...defaultSfxSettings(), enabled: true, ...partial };
}

const HYPE = "This is the biggest mistake everyone makes!";
const PLAIN = "we walked over to the market yesterday afternoon.";
const SUS = "He is acting so sus right now!";

describe("planSfxCues", () => {
  it("returns nothing when the master switch is off", () => {
    expect(planSfxCues([seg("a", HYPE, 0)], { ...settings(), enabled: false })).toEqual([]);
  });

  it("returns nothing when every sound is toggled off", () => {
    const off = settings({ sounds: { vineBoom: false, fa: false, amongUs: false } });
    expect(planSfxCues([seg("a", HYPE, 0)], off)).toEqual([]);
  });

  it("places a hit just after an emphatic line and skips plain ones", () => {
    const captions = [seg("a", PLAIN, 0), seg("b", HYPE, 30)];
    const cues = planSfxCues(captions, settings());
    expect(cues).toHaveLength(1);
    const lastWordEnd = captions[1].words[captions[1].words.length - 1].end;
    expect(cues[0].time).toBeCloseTo(lastWordEnd + 0.08, 3);
    expect(cues[0].soundId).toBe("vineBoom");
  });

  it("spaces hits out by the sensitivity's minimum gap", () => {
    const captions = [seg("a", HYPE, 0), seg("b", HYPE, 5), seg("c", HYPE, 30)];
    const cues = planSfxCues(captions, settings());
    // The second hype line lands ~5s after the first — inside the balanced
    // 12s gap — so only the first and third get a hit.
    expect(cues).toHaveLength(2);
    expect(cues[0].time).toBeLessThan(5);
    expect(cues[1].time).toBeGreaterThan(30);
  });

  it("matches the Among Us sound to sus wording", () => {
    const cues = planSfxCues([seg("a", SUS, 0)], settings());
    expect(cues).toHaveLength(1);
    expect(cues[0].soundId).toBe("amongUs");
  });

  it("falls back to an enabled sound when the matched one is off", () => {
    const noSus = settings({ sounds: { vineBoom: true, fa: true, amongUs: false } });
    const cues = planSfxCues([seg("a", SUS, 0)], noSus);
    expect(cues).toHaveLength(1);
    expect(cues[0].soundId).toBe("vineBoom");
  });

  it("ignores disabled caption segments", () => {
    const disabled = { ...seg("a", HYPE, 0), enabled: false };
    expect(planSfxCues([disabled], settings())).toEqual([]);
  });
});
