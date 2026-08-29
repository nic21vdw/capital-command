import { describe, expect, it } from "vitest";
import { shortsAudioArgs, shortsAudioFilter, shortsMasteringChain, shortsVideoArgs } from "./audio";

describe("shortsAudioFilter", () => {
  const filter = shortsAudioFilter();

  it("normalizes to the platforms' own loudness target under a safe true peak", () => {
    expect(filter).toContain("loudnorm=I=-14:TP=-1.5:LRA=9");
  });

  it("compresses before it normalizes, and limits after", () => {
    const order = ["acompressor", "loudnorm", "alimiter"].map((name) => filter.indexOf(name));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("clears sub-bass rumble a phone speaker cannot reproduce anyway", () => {
    expect(filter).toContain("highpass=f=70");
  });

  it("lands on the sample rate the encoder settings expect", () => {
    expect(filter.endsWith("aresample=48000")).toBe(true);
    expect(shortsAudioArgs()).toContain("48000");
  });
});

describe("shortsMasteringChain", () => {
  it("masters a finished mix into the labelled output", () => {
    const chain = shortsMasteringChain("amix", "aout");
    expect(chain.startsWith("[amix]")).toBe(true);
    expect(chain.endsWith("[aout]")).toBe(true);
    expect(chain).toContain("loudnorm");
  });
});

describe("shortsVideoArgs", () => {
  it("uses the shared master encode so shorts match long-form", () => {
    const args = shortsVideoArgs();
    expect(args).toContain("libx264");
    expect(Number(args[args.indexOf("-crf") + 1])).toBeLessThanOrEqual(18);
    expect(args[args.indexOf("-preset") + 1]).toBe("medium");
  });

  it("stays in the pixel format every platform accepts", () => {
    expect(shortsVideoArgs()).toContain("yuv420p");
  });
});

describe("shortsAudioArgs", () => {
  it("uses the shared master AAC encode", () => {
    const args = shortsAudioArgs();
    expect(Number.parseInt(args[args.indexOf("-b:a") + 1], 10)).toBeGreaterThanOrEqual(256);
  });
});
