import { describe, expect, it } from "vitest";
import {
  CLIP_SECTION_FORMAT,
  FULL_VIDEO_FORMAT,
  MASTER_AUDIO_BITRATE,
  MASTER_CRF,
  MASTER_PRESET,
  containScale,
  coverScale,
  evenPixels,
  masterAudioArgs,
  masterVideoArgs,
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

describe("source format selectors", () => {
  it("pulls clip sections at 1080p instead of stretching a 720p download", () => {
    expect(CLIP_SECTION_FORMAT).toContain("height<=1080");
    expect(CLIP_SECTION_FORMAT).not.toContain("720");
  });

  it("keeps a long-form VOD at 1440p when the source has it, and 1080p otherwise", () => {
    expect(FULL_VIDEO_FORMAT).toContain("height<=1440");
    expect(FULL_VIDEO_FORMAT).toContain("height<=1080");
    expect(FULL_VIDEO_FORMAT).not.toContain("720");
  });
});
