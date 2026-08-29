import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CENTER_BLUR_ZOOM, MAX_CENTER_BLUR_ZOOM } from "./centerBlur";
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
    const chain = animatedReframeChain("0:v", "vout", 1920, 1080, 1.3, 0.0, -0.3, 0.5, 30);

    // The zoom is driven per-frame by zoompan's input time (seconds).
    expect(chain).toContain("it/0.500");
    // Ease-out cubic ramp toward the (1.3 - 1) = 0.3 delta above 1x.
    expect(chain).toContain("zoompan=z='1+0.3000*(1-pow(1-min(1,it/0.500),3))'");
    // Cover is pre-scaled to the max zoom so zoompan's crop at 1.3x is 1:1
    // with the output instead of bilinear-upscaling a 1920x1080 window.
    expect(chain).toContain("scale=2496:1404:force_original_aspect_ratio=increase");
    expect(chain).toContain("crop=2496:1404");
    // One output frame per input frame, scaled back up to fill the frame.
    expect(chain).toContain(":d=1:s=1920x1080:fps=30");
    // Vertical focus offset is carried into the zoom window position.
    expect(chain).toContain("y='(ih-ih/zoom)/2*(1+-0.3000)'");
    // Both split branches are normalized to the export fps so the blurred
    // background and the zoompan output stay frame-locked in the overlay.
    expect(chain).toContain("[0:v]fps=30,split=2");
    // No constant zoom crop like the static reframeChain uses.
    expect(chain).not.toContain("scale=iw*1.3");
    // The animation must never run through crop's w/h: those expressions are
    // evaluated once at graph-config time (t = NaN), which fails the render.
    expect(chain).not.toContain("crop=w=");
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
    // Contain-fit into the frame, then punched in so the video is bigger than
    // the blurred fill around it; the overlay clips whatever hangs over.
    expect(filter).toContain("[fg]scale=1080:1920:force_original_aspect_ratio=decrease");
    expect(filter).toContain("flags=lanczos+accurate_rnd+full_chroma_int");
    expect(filter).toContain(`scale=iw*${DEFAULT_CENTER_BLUR_ZOOM.toFixed(4)}:ih*${DEFAULT_CENTER_BLUR_ZOOM.toFixed(4)}`);
    expect(filter).toContain("boxblur=12:2");
    expect(filter).toContain("overlay=(W-w)/2:(H-h)/2");
    // Burns the caption/watermark document in.
    expect(filter).toContain("ass='/tmp/caps.ass'[vout]");
  });

  it("renders the whole width when the punch-in is turned off", async () => {
    runFfmpeg.mockClear();
    await renderCaptionedVertical("in.mp4", "out.mp4", null, true, undefined, 1);
    const filter = filterOf(runFfmpeg.mock.calls);
    expect(filter).toContain("scale=iw*1.0000:ih*1.0000");
  });

  it("does not punch in past the ceiling, however hard it is asked to", async () => {
    runFfmpeg.mockClear();
    await renderCaptionedVertical("in.mp4", "out.mp4", null, true, undefined, 50);
    const filter = filterOf(runFfmpeg.mock.calls);
    expect(filter).toContain(`scale=iw*${MAX_CENTER_BLUR_ZOOM.toFixed(4)}:ih*${MAX_CENTER_BLUR_ZOOM.toFixed(4)}`);
  });

  it("fills the frame with the speaker when the clip was auto-framed", async () => {
    runFfmpeg.mockClear();
    await renderCaptionedVertical("in.mp4", "out.mp4", "/tmp/caps.ass", true, {
      framing: {
        mode: "subject-fill",
        crop: { w: 0.32, h: 1 },
        keyframes: [
          { t: 0, x: 0.5, y: 0 },
          { t: 4, x: 0.6, y: 0 }
        ],
        confidence: 1,
        reason: ""
      },
      target: { sourceW: 1920, sourceH: 1080, targetW: 1080, targetH: 1920 }
    });
    const filter = filterOf(runFfmpeg.mock.calls);
    // A tracked crop that fills the frame — no blurred fill, no letterbox.
    expect(filter).toContain("[0:v]crop=614:1080:x='if(lt(t,4.00)");
    expect(filter).not.toContain("boxblur");
    expect(filter).toContain("ass='/tmp/caps.ass'[vout]");
  });

  it("leads with the detected camera when the speaker is an overlay", async () => {
    runFfmpeg.mockClear();
    await renderCaptionedVertical("in.mp4", "out.mp4", null, true, {
      framing: {
        mode: "speaker-stack",
        faceSource: { x: 0.7, y: 0.6, w: 0.24, h: 0.34 },
        confidence: 0.8,
        reason: ""
      },
      target: { sourceW: 1920, sourceH: 1080, targetW: 1080, targetH: 1920 }
    });
    const filter = filterOf(runFfmpeg.mock.calls);
    expect(filter).toContain("crop=iw*0.2400:ih*0.3400:iw*0.7000:ih*0.6000");
    expect(filter).toContain("[vc]null[vout]");
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
