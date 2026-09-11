import { describe, expect, it } from "vitest";
import {
  CLIP_SECTION_FORMAT,
  FULL_VIDEO_FORMAT,
  INTERMEDIATE_CRF,
  MASTER_AUDIO_BITRATE,
  MASTER_CRF,
  MASTER_PRESET,
  MAX_SOURCE_HEIGHT,
  clipSectionFormat,
  containScale,
  coverScale,
  evenPixels,
  fullVideoFormat,
  intermediateVideoArgs,
  masterAudioArgs,
  masterVideoArgs,
  resolveOutputFrame,
  scaleFilter
} from "./encode";

describe("master encode", () => {
  it("encodes burned captions and screenshare text sharper than a fast CRF 20 pass", () => {
    const args = masterVideoArgs();
    expect(args).toContain("libx264");
    expect(args).toContain("high");
    expect(args).toContain("yuv420p");
    expect(args[args.indexOf("-preset") + 1]).toBe(MASTER_PRESET);
    expect(Number(args[args.indexOf("-crf") + 1])).toBe(MASTER_CRF);
    expect(MASTER_CRF).toBeLessThanOrEqual(18);
    expect(MASTER_PRESET).not.toMatch(/fast/);
  });

  it("keeps stereo AAC at a bitrate the platforms will not audibly re-crush", () => {
    const args = masterAudioArgs();
    expect(args).toContain("aac");
    expect(args).toContain("48000");
    expect(args).toContain("2");
    expect(args[args.indexOf("-b:a") + 1]).toBe(MASTER_AUDIO_BITRATE);
    expect(Number.parseInt(MASTER_AUDIO_BITRATE, 10)).toBeGreaterThanOrEqual(256);
  });

  it("lets a caller tighten CRF without changing the rest of the encode", () => {
    expect(masterVideoArgs(16)[masterVideoArgs(16).indexOf("-crf") + 1]).toBe("16");
  });
});

describe("scaleFilter", () => {
  it("uses lanczos with accurate chroma on every quality-critical scale", () => {
    expect(scaleFilter(1080, 1920)).toBe("scale=1080:1920:flags=lanczos+accurate_rnd+full_chroma_int");
    expect(containScale(1080, 1920)).toContain("force_original_aspect_ratio=decrease");
    expect(containScale(1080, 1920)).toContain("flags=lanczos+accurate_rnd+full_chroma_int");
    expect(coverScale(1920, 1080)).toContain("force_original_aspect_ratio=increase");
  });

  it("accepts expression widths so a punch-in can scale in one filter", () => {
    expect(scaleFilter("iw*1.3300", "ih*1.3300")).toContain("scale=iw*1.3300:ih*1.3300");
  });
});

describe("evenPixels", () => {
  it("rounds to an even size yuv420p can encode", () => {
    expect(evenPixels(1080)).toBe(1080);
    expect(evenPixels(2496)).toBe(2496);
    expect(evenPixels(1403.7)).toBe(1404);
    expect(evenPixels(1)).toBe(2);
  });
});

describe("intermediate encode", () => {
  it("keeps a file another filter pass will re-encode near-lossless", () => {
    const args = intermediateVideoArgs();
    expect(Number(args[args.indexOf("-crf") + 1])).toBe(INTERMEDIATE_CRF);
    expect(INTERMEDIATE_CRF).toBeLessThanOrEqual(14);
    expect(INTERMEDIATE_CRF).toBeLessThan(MASTER_CRF);
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("yuv420p");
  });
});

describe("source format selectors", () => {
  it("asks for the best stream up to 4K when nothing is capped", () => {
    expect(FULL_VIDEO_FORMAT).toContain(`bv*[height<=${MAX_SOURCE_HEIGHT}]+ba`);
    expect(CLIP_SECTION_FORMAT).toContain(`bv*[height<=${MAX_SOURCE_HEIGHT}]+ba`);
  });

  /**
   * The bug this pins: the old selectors ended in a bare `b`, which on YouTube
   * is itag 18 — 640x360. Whenever the adaptive tiers in front of it could not
   * be served, a whole stream came down at 360p and every render upscaled it.
   * Adaptive must be exhausted before anything muxed is considered.
   */
  it("exhausts every adaptive tier before it will take a muxed fallback", () => {
    const tiers = FULL_VIDEO_FORMAT.split("/");
    const lastAdaptive = tiers.map((tier) => tier.startsWith("bv*")).lastIndexOf(true);
    const firstMuxed = tiers.findIndex((tier) => !tier.startsWith("bv*"));
    expect(lastAdaptive).toBeGreaterThanOrEqual(0);
    expect(firstMuxed).toBeGreaterThan(lastAdaptive);
    expect(tiers[tiers.length - 1]).toBe("b");
  });

  it("caps the download at the chosen output resolution", () => {
    expect(fullVideoFormat({ resolution: "1080", frameRate: "source" })).toContain("bv*[height<=1080]+ba");
    expect(clipSectionFormat({ resolution: "720", frameRate: "source" })).toContain("bv*[height<=720]+ba");
  });
});

describe("resolveOutputFrame", () => {
  it("keeps a 16:9 source exactly as it is when nothing is capped", () => {
    expect(resolveOutputFrame({ width: 2560, height: 1440, fps: 60 })).toEqual({
      width: 2560,
      height: 1440,
      fps: 60
    });
  });

  /**
   * The long-form export used to pad every source into a hardcoded 1920x1080 at
   * 30 fps, so a 360p download was lanczos-upscaled to 1080p and encoded at
   * CRF 17: three times the pixels, none of the detail, and a 60 fps recording
   * lost half its frames on the way.
   */
  it("never upscales a small source and never invents frames", () => {
    expect(resolveOutputFrame({ width: 640, height: 360, fps: 30 })).toEqual({
      width: 640,
      height: 360,
      fps: 30
    });
    expect(resolveOutputFrame({ width: 640, height: 360, fps: 30 }, { resolution: "2160", frameRate: "60" })).toEqual({
      width: 640,
      height: 360,
      fps: 30
    });
  });

  it("scales down to a chosen height, keeping aspect", () => {
    expect(resolveOutputFrame({ width: 3840, height: 2160, fps: 60 }, { resolution: "1080", frameRate: "source" })).toEqual(
      { width: 1920, height: 1080, fps: 60 }
    );
  });

  it("caps a chosen frame rate without touching the size", () => {
    expect(resolveOutputFrame({ width: 1920, height: 1080, fps: 60 }, { resolution: "source", frameRate: "30" })).toEqual(
      { width: 1920, height: 1080, fps: 30 }
    );
  });

  it("keeps an ultrawide's own width rather than squashing it into 16:9", () => {
    expect(resolveOutputFrame({ width: 2560, height: 1080, fps: 30 }).width).toBe(2560);
  });

  it("widens a 4:3 source's canvas to 16:9 so it letterboxes instead of stretching", () => {
    expect(resolveOutputFrame({ width: 1440, height: 1080, fps: 30 })).toEqual({
      width: 1920,
      height: 1080,
      fps: 30
    });
  });

  it("builds a 9:16 frame whose short side never exceeds the source width", () => {
    expect(resolveOutputFrame({ width: 1920, height: 1080, fps: 30 }, undefined, "vertical")).toEqual({
      width: 1080,
      height: 1920,
      fps: 30
    });
    expect(resolveOutputFrame({ width: 640, height: 360, fps: 30 }, undefined, "vertical").width).toBe(640);
  });

  it("falls back to 1080p30 when the source could not be probed", () => {
    expect(resolveOutputFrame({ width: 0, height: 0, fps: 0 })).toEqual({ width: 1920, height: 1080, fps: 30 });
  });
});
