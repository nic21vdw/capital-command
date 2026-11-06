import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dataPath } from "@/lib/paths";
import { runFfmpeg } from "./ffmpeg";
import { SHORTS_LOUDNESS_LUFS, SHORTS_LOUDNESS_RANGE, SHORTS_TRUE_PEAK_DB,
  shortsAudioArgs, shortsAudioFilter, shortsMasteringChain, shortsVideoArgs } from "./audio";

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

  it("keeps the decoded AAC output at the declared mastering loudness", async () => {
    const folder = dataPath("audio-mastering-test");
    await mkdir(folder, { recursive: true });
    const output = path.join(folder, "synthetic-master.m4a");
    await runFfmpeg(["-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i",
      "sine=frequency=440:sample_rate=48000:duration=12", "-af", shortsAudioFilter(), ...shortsAudioArgs(), output]);
    // Measure the encoded result. loudnorm's input_i is the decoded file's
    // integrated loudness; its output_i would describe another normalization.
    const { stderr } = await runFfmpeg(["-hide_banner", "-nostdin", "-i", output, "-af",
      `loudnorm=I=${SHORTS_LOUDNESS_LUFS}:TP=${SHORTS_TRUE_PEAK_DB}:LRA=${SHORTS_LOUDNESS_RANGE}:print_format=json`, "-f", "null", "-"]);
    const match = stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
    expect(match, "FFmpeg must report the actual AAC loudness measurement").not.toBeNull();
    const measurement = JSON.parse(match![0]) as { input_i: string; input_tp: string };
    const integratedLufs = Number(measurement.input_i);
    const truePeakDb = Number(measurement.input_tp);
    if (process.env.AUDIO_MASTERING_EVIDENCE_DIR) {
      const evidence = process.env.AUDIO_MASTERING_EVIDENCE_DIR;
      await mkdir(evidence, { recursive: true });
      await copyFile(output, path.join(evidence, "synthetic-master.m4a"));
      await writeFile(path.join(evidence, "measurement.json"), JSON.stringify({ syntheticOnly: true,
        filter: shortsAudioFilter(), encoderArgs: shortsAudioArgs(), declaredIntegratedLufs: SHORTS_LOUDNESS_LUFS,
        declaredTruePeakDb: SHORTS_TRUE_PEAK_DB, integratedLufs, truePeakDb, measurement }, null, 2));
    }
    expect(Number.isFinite(integratedLufs)).toBe(true);
    // Permit meter/codec rounding, but catch the limiter's former ~1 dB gain.
    expect(Math.abs(integratedLufs - SHORTS_LOUDNESS_LUFS)).toBeLessThanOrEqual(0.2);
    expect(truePeakDb).toBeLessThanOrEqual(SHORTS_TRUE_PEAK_DB + 0.2);
  }, 20_000);
});
