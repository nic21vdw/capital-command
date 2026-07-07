import { describe, expect, it, vi } from "vitest";
import { CLIP_LAYOUTS } from "./layouts";
import { animatedReframeChain, reframeChain, renderCaptionedVertical, stackedLayoutChain } from "./render";

const runFfmpeg = vi.fn((..._args: unknown[]): Promise<void> => Promise.resolve());
vi.mock("./ffmpeg", () => ({ runFfmpeg: (...args: unknown[]) => runFfmpeg(...args) }));

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

  it("ramps the punch-in zoom from 1x with a time-based ease-out instead of a static crop", () => {
    const chain = animatedReframeChain("0:v", "vout", 1920, 1080, 1.3, 0.0, -0.3, 0.5);

    // The crop window is driven per-frame by t (seconds), not a constant scale.
    expect(chain).toContain("t/0.500");
    // Ease-out cubic ramp toward the (1.3 - 1) = 0.3 delta above 1x.
    expect(chain).toContain("(1+0.3000*(1-pow(1-min(1,t/0.500),3)))");
    // Zoom shrinks the crop window (iw/z) then scales it back up to fill.
    expect(chain).toContain("crop=w='iw/(1+0.3000");
    expect(chain).toContain("scale=1920:1080[__fgs]");
    // Vertical focus offset is carried into the crop position.
    expect(chain).toContain("*(1+-0.3000)");
    // No constant zoom crop like the static reframeChain uses.
    expect(chain).not.toContain("scale=iw*1.3");
  });

  it("falls back to a plain cover crop when no zoom is requested", () => {
    const animated = animatedReframeChain("0:v", "vout", 1920, 1080, 1, 0, 0, 0.5);
    const plain = reframeChain("0:v", "vout", 1920, 1080, 1, 0, 0);
    expect(animated).toBe(plain);
    expect(animated).not.toContain("pow(");
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

  it("applies a per-project screen source override to every screen layer", () => {
    const filter = stackedLayoutChain("restream-stack", undefined, 1080, 1920, undefined, {
      x: 0.05,
      y: 0.1,
      w: 0.55,
      h: 0.8
    });
    // Screen layer crops down to the requested region…
    expect(filter).toContain("crop=iw*0.5500:ih*0.8000:iw*0.0500:ih*0.1000");
    // …while the face layer keeps its default streamer-camera crop.
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

describe("renderCaptionedVertical", () => {
  function filterOf(calls: unknown[][]): string {
    const args = (calls[0]?.[0] ?? []) as string[];
    return args[args.indexOf("-filter_complex") + 1];
  }

  it("composes a centered 9:16 clip over a blurred fill and burns in the ass overlay", async () => {
    runFfmpeg.mockClear();
    await renderCaptionedVertical("in.mp4", "out.mp4", "/tmp/caps.ass", true);
    const filter = filterOf(runFfmpeg.mock.calls);
    // Centered vertical over a blurred, dimmed fill of itself (nothing cropped).
    expect(filter).toContain("scale=1080:-2[fgs]");
    expect(filter).toContain("boxblur=12:2");
    expect(filter).toContain("overlay=(W-w)/2:(H-h)/2");
    // Burns the caption/watermark document in.
    expect(filter).toContain("ass='/tmp/caps.ass'[vout]");
  });

  it("skips the ass filter when there is nothing to burn in", async () => {
    runFfmpeg.mockClear();
    await renderCaptionedVertical("in.mp4", "out.mp4", null, false);
    const filter = filterOf(runFfmpeg.mock.calls);
    expect(filter).toContain("[vc]null[vout]");
    expect(filter).not.toContain("ass=");
    // No audio track means no aac mapping.
    const args = runFfmpeg.mock.calls[0][0] as string[];
    expect(args).toContain("-an");
    expect(args).not.toContain("aac");
  });
});
