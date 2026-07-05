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

  it("keeps the whole screen visible in the stacked layouts (contain) while faces fill their slot (cover)", () => {
    const stack = CLIP_LAYOUTS["restream-stack"];
    expect(stack.label).toBe("Screen + face");
    expect(stack.layers).toHaveLength(2);
    expect(stack.layers[0]).toMatchObject({ kind: "screen", fit: "contain", source: { x: 0, y: 0, w: 1, h: 1 } });
    expect(stack.layers[1]).toMatchObject({
      kind: "face",
      fit: "cover",
      source: { x: 0.58, y: 0.05, w: 0.42, h: 0.5 }
    });
  });

  it("makes Face lead a camera-first composition", () => {
    expect(CLIP_LAYOUTS["face-focus"].layers[0]).toMatchObject({ kind: "screen", fit: "contain" });
    expect(CLIP_LAYOUTS["face-focus"].layers[1]).toMatchObject({
      kind: "face",
      fit: "cover",
      dest: { x: 0, y: 0.36, w: 1, h: 0.56 }
    });
  });

  it("splits the input explicitly and centers contain layers over the blur base", () => {
    const filter = stackedLayoutChain("restream-stack");

    // One split feeds the blur base plus every layer — no reused input pads.
    expect(filter).toContain("split=3[base0][in0][in1]");
    // Screen layer: contain (decrease) with NO opaque pad — the blurred base
    // shows through the letterbox instead of a dark box.
    expect(filter).toContain("force_original_aspect_ratio=decrease");
    expect(filter).not.toContain("pad=");
    // Layers are centered inside their dest rects.
    expect(filter).toMatch(/overlay=\d+\+\(\d+-w\)\/2:\d+\+\(\d+-h\)\/2/);
    // Face layer crops the top-right streamer camera region.
    expect(filter).toContain("crop=iw*0.4200:ih*0.5000:iw*0.5800:ih*0.0500");
  });

  it("scales the layout chain to any output size", () => {
    const filter = stackedLayoutChain("restream-stack", undefined, 540, 960);
    expect(filter).toContain("scale=270:480");
    expect(filter).toContain("scale=540:960");
  });

  it("applies a per-project face source override to every face layer", () => {
    const filter = stackedLayoutChain("face-focus", undefined, 1080, 1920, { x: 0.62, y: 0.02, w: 0.34, h: 0.46 });
    expect(filter).toContain("crop=iw*0.3400:ih*0.4600:iw*0.6200:ih*0.0200");
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
