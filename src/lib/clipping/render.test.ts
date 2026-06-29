import { describe, expect, it } from "vitest";
import { CLIP_LAYOUTS } from "./layouts";
import { reframeChain, stackedLayoutChain } from "./render";

describe("reframeChain", () => {
  it("uses cover crop math so zoom and pan affect the exported frame", () => {
    const chain = reframeChain("0:v", "vout", 1080, 1920, 1.8, 0.4, -0.25);

    expect(chain).toContain("force_original_aspect_ratio=increase");
    expect(chain).toContain("scale=iw*1.8:ih*1.8");
    expect(chain).toContain("crop=1080:1920");
    expect(chain).toContain("0.4000*(iw-1080)/2");
    expect(chain).toContain("-0.2500*(ih-1920)/2");
    expect(chain).not.toContain("force_original_aspect_ratio=decrease");
  });

  it("exposes Restream-style stacked layout presets", () => {
    expect(CLIP_LAYOUTS["restream-stack"].label).toBe("Screen + face");
    expect(CLIP_LAYOUTS["restream-stack"].layers).toHaveLength(2);
    expect(CLIP_LAYOUTS["restream-stack"].layers[0]).toMatchObject({
      kind: "screen",
      source: { x: 0, y: 0, w: 1, h: 0.68 },
      dest: { x: 0, y: 0, w: 1, h: 0.56 }
    });
    expect(CLIP_LAYOUTS["restream-stack"].layers[1]).toMatchObject({
      kind: "face",
      fit: "contain",
      source: { x: 0.58, y: 0.05, w: 0.42, h: 0.5 },
      dest: { x: 0, y: 0.56, w: 1, h: 0.44 }
    });
  });

  it("makes Face lead a camera-first composition", () => {
    expect(CLIP_LAYOUTS["face-focus"].layers[0]).toMatchObject({
      kind: "screen",
      dest: { x: 0.05, y: 0.04, w: 0.9, h: 0.25 }
    });
    expect(CLIP_LAYOUTS["face-focus"].layers[1]).toMatchObject({
      kind: "face",
      fit: "contain",
      source: { x: 0.58, y: 0.05, w: 0.42, h: 0.5 },
      dest: { x: 0, y: 0.34, w: 1, h: 0.56 }
    });
  });

  it("renders face layers with contain scaling from the top-right streamer camera", () => {
    const filter = stackedLayoutChain("restream-stack");

    expect(filter).toContain("force_original_aspect_ratio=decrease");
    expect(filter).toContain("pad=1080:845:(ow-iw)/2:(oh-ih)/2");
    expect(filter).toContain("crop=iw*0.4200:ih*0.5000:iw*0.5800:ih*0.0500");
  });

  it("applies saved streamer framing overrides to the rendered layout", () => {
    const filter = stackedLayoutChain("face-focus", {
      "face-focus": {
        layers: [{}, { source: { x: 0.62, y: 0.02, w: 0.34, h: 0.46 } }]
      }
    });

    expect(filter).toContain("crop=iw*0.3400:ih*0.4600:iw*0.6200:ih*0.0200");
  });
});
