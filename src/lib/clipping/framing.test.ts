import { describe, expect, it } from "vitest";
import {
  framingToReframe,
  framingVideoTopFrac,
  keyframeExpression,
  planFraming,
  subjectFillChain,
  type FramingTarget
} from "./framing";
import type { SubjectSample, SubjectTrack } from "./subject";

const target: FramingTarget = { sourceW: 1920, sourceH: 1080, targetW: 1080, targetH: 1920 };

function track(partial: Partial<SubjectTrack> & { samples: SubjectSample[] }): SubjectTrack {
  const areas = partial.samples.map((s) => s.w * s.h);
  return {
    confidence: 0.8,
    area: areas.length ? areas[0] : 0,
    drift: 0,
    frames: partial.samples.length,
    ...partial
  };
}

function samples(count: number, box: { cx: number; cy: number; w: number; h: number }): SubjectSample[] {
  return Array.from({ length: count }, (_, i) => ({ t: i / 2, ...box, confidence: 0.8 }));
}

describe("planFraming", () => {
  it("falls back to the neutral composition when no speaker was found", () => {
    expect(planFraming(null, target).mode).toBe("center-blur");
    expect(planFraming(track({ samples: [], confidence: 0 }), target).mode).toBe("center-blur");
  });

  it("falls back when the detection is not confident enough to trust", () => {
    const shaky = track({ samples: samples(6, { cx: 0.5, cy: 0.5, w: 0.3, h: 0.5 }), confidence: 0.1 });
    expect(planFraming(shaky, target).mode).toBe("center-blur");
  });

  it("fills the frame with a speaker who carries the shot", () => {
    const plan = planFraming(track({ samples: samples(6, { cx: 0.4, cy: 0.45, w: 0.3, h: 0.55 }), area: 0.16 }), target);
    expect(plan.mode).toBe("subject-fill");
    // The crop is exactly the output aspect, so nothing is letterboxed.
    expect((plan.crop!.w * target.sourceW) / (plan.crop!.h * target.sourceH)).toBeCloseTo(1080 / 1920, 3);
    expect(plan.keyframes!.length).toBeGreaterThan(0);
    for (const frame of plan.keyframes!) {
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.x + plan.crop!.w).toBeLessThanOrEqual(1.0001);
      expect(frame.y + plan.crop!.h).toBeLessThanOrEqual(1.0001);
    }
  });

  it("never zooms past the point where the source would go soft", () => {
    const tiny = track({ samples: samples(6, { cx: 0.5, cy: 0.5, w: 0.12, h: 0.18 }), area: 0.09 });
    const plan = planFraming(tiny, target);
    expect(plan.mode).toBe("subject-fill");
    expect(plan.crop!.h * target.sourceH).toBeGreaterThanOrEqual(target.targetH / 2.4 - 1);
  });

  it("leads with the camera when the speaker is a small overlay on a screenshare", () => {
    const overlay = track({ samples: samples(6, { cx: 0.78, cy: 0.24, w: 0.14, h: 0.28 }), area: 0.039 });
    const plan = planFraming(overlay, target);
    expect(plan.mode).toBe("speaker-stack");
    expect(plan.faceSource!.x).toBeGreaterThan(0.5);
    expect(plan.faceSource!.x + plan.faceSource!.w).toBeLessThanOrEqual(1.0001);
    expect(plan.faceSource!.w).toBeGreaterThan(0.14);
  });

  it("thins a wandering track down to a handful of keyframes", () => {
    const wander = Array.from({ length: 120 }, (_, i) => ({
      t: i / 2,
      cx: 0.5 + Math.sin(i / 6) * 0.12,
      cy: 0.5,
      w: 0.3,
      h: 0.55,
      confidence: 0.8
    }));
    const plan = planFraming(track({ samples: wander, area: 0.16 }), target);
    expect(plan.keyframes!.length).toBeLessThanOrEqual(12);
    expect(plan.keyframes![plan.keyframes!.length - 1].t).toBeCloseTo(59.5, 5);
  });
});

describe("keyframeExpression", () => {
  it("holds a single value", () => {
    expect(keyframeExpression([{ t: 0, v: 120.4 }])).toBe("120");
  });

  it("ramps between points and holds the last one", () => {
    const expression = keyframeExpression([
      { t: 0, v: 0 },
      { t: 2, v: 100 }
    ]);
    expect(expression).toBe("if(lt(t,2.00),0+(100)*(t-0.00)/2.00,100)");
  });
});

describe("subjectFillChain", () => {
  it("crops the tracked window and fills the output with it", () => {
    const plan = planFraming(track({ samples: samples(4, { cx: 0.4, cy: 0.45, w: 0.3, h: 0.55 }), area: 0.16 }), target);
    const chain = subjectFillChain(plan, target);
    expect(chain.startsWith("[0:v]crop=")).toBe(true);
    expect(chain.endsWith("[vc]")).toBe(true);
    expect(chain).toContain("scale=1080:1920");
    // No blurred fill: an aspect-matched crop has nothing to fill around it.
    expect(chain).not.toContain("boxblur");
    const [, cropW, cropH] = chain.match(/crop=(\d+):(\d+):/) as RegExpMatchArray;
    expect(Number(cropW) / Number(cropH)).toBeCloseTo(1080 / 1920, 2);
    expect(Number(cropW)).toBeLessThanOrEqual(target.sourceW);
    expect(Number(cropH)).toBeLessThanOrEqual(target.sourceH);
  });

  it("keeps the crop inside the source at every keyframe", () => {
    const plan = planFraming(
      track({ samples: samples(4, { cx: 0.95, cy: 0.9, w: 0.3, h: 0.55 }), area: 0.16 }),
      target
    );
    const chain = subjectFillChain(plan, target);
    const [, cropW] = chain.match(/crop=(\d+):(\d+):/) as RegExpMatchArray;
    const xExpression = (chain.match(/x='([^']+)'/) as RegExpMatchArray)[1];
    const positions = [...xExpression.matchAll(/(?:^|,)(-?\d+)(?:\+|,|\))/g)].map((m) => Number(m[1]));
    expect(positions.length).toBeGreaterThan(0);
    for (const x of positions) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + Number(cropW)).toBeLessThanOrEqual(target.sourceW);
    }
  });
});

describe("framingToReframe", () => {
  it("says 'no zoom' when the crop is the full-height 9:16 window", () => {
    const plan = planFraming(track({ samples: samples(4, { cx: 0.5, cy: 0.5, w: 0.6, h: 1 }), area: 0.6 }), target);
    const reframe = framingToReframe(plan, target)!;
    expect(reframe.scale).toBeCloseTo(1, 2);
    expect(reframe.offsetX).toBeCloseTo(0, 2);
  });

  it("zooms in and pans towards a speaker standing off to one side", () => {
    const plan = planFraming(track({ samples: samples(4, { cx: 0.78, cy: 0.5, w: 0.2, h: 0.4 }), area: 0.08 }), target);
    const reframe = framingToReframe(plan, target)!;
    expect(reframe.scale).toBeGreaterThan(1);
    expect(reframe.scale).toBeLessThanOrEqual(8);
    expect(reframe.offsetX).toBeGreaterThan(0.3);
    expect(Math.abs(reframe.offsetX)).toBeLessThanOrEqual(1);
  });

  it("has nothing to say about the modes the editor renders differently", () => {
    expect(framingToReframe({ mode: "center-blur", confidence: 0, reason: "" }, target)).toBeNull();
  });
});

describe("framingVideoTopFrac", () => {
  it("puts the title over footage only where there is no letterbox to use", () => {
    expect(framingVideoTopFrac({ mode: "subject-fill", confidence: 1, reason: "" }, target)).toBe(0);
    // 16:9 into 9:16, punched in 1.25x: a 0.396-tall band, so 0.302 above it.
    expect(framingVideoTopFrac({ mode: "center-blur", confidence: 0, reason: "" }, target)).toBeCloseTo(0.302, 3);
  });

  it("follows the centre + blur zoom, so the title never lands on the footage", () => {
    const neutral = { mode: "center-blur", confidence: 0, reason: "" } as const;
    // Zooming in grows the video band, which pushes the title up.
    expect(framingVideoTopFrac(neutral, target, 1)).toBeCloseTo(0.342, 3);
    expect(framingVideoTopFrac(neutral, target, 1.6)).toBeLessThan(framingVideoTopFrac(neutral, target, 1.25));
  });
});
