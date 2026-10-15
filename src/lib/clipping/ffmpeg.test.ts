import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenderCanceledError, parseVideoStreamInfo, probeVideoStream, runFfmpeg } from "@/lib/clipping/ffmpeg";

const spawned = vi.hoisted(() => ({
  calls: 0,
  kills: 0,
  onSpawn: null as null | (() => void),
  child: null as null | {
    emit: (event: string, ...args: unknown[]) => boolean;
    stdout: { emit: (event: string, ...args: unknown[]) => boolean };
    stderr: { emit: (event: string, ...args: unknown[]) => boolean };
  }
}));

vi.mock("node:child_process", () => ({
  spawn: () => {
    spawned.calls += 1;
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: () => {
        spawned.kills += 1;
        child.emit("close", null);
        return true;
      }
    });
    spawned.child = child;
    spawned.onSpawn?.();
    return child;
  }
}));

beforeEach(() => {
  spawned.calls = 0;
  spawned.kills = 0;
  spawned.onSpawn = null;
  spawned.child = null;
});

/** Parsing of `ffmpeg -i` stderr into display dimensions and duration. */

const LANDSCAPE = [
  "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':",
  "  Duration: 00:00:27.43, start: 0.000000, bitrate: 3311 kb/s",
  "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 3255 kb/s, 30 fps, 30 tbr, 15360 tbn (default)",
  "  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s (default)"
].join("\n");

const VERTICAL = [
  "  Duration: 00:01:02.10, start: 0.000000, bitrate: 2100 kb/s",
  "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv), 1080x1920, 2000 kb/s, 30 fps, 30 tbr, 15360 tbn (default)"
].join("\n");

const ROTATED = [
  "  Duration: 00:00:14.90, start: 0.000000, bitrate: 8000 kb/s",
  "  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, bt709), 1920x1080, 7900 kb/s, 29.97 fps, 29.97 tbr, 600 tbn (default)",
  "      Side data:",
  "        displaymatrix: rotation of -90.00 degrees"
].join("\n");

describe("parseVideoStreamInfo", () => {
  it("reads dimensions and duration from a landscape stream", () => {
    expect(parseVideoStreamInfo(LANDSCAPE)).toEqual({ width: 1920, height: 1080, durationSec: 27.43, fps: 30 });
  });

  it("reads a vertical stream without SAR/DAR decoration", () => {
    expect(parseVideoStreamInfo(VERTICAL)).toEqual({ width: 1080, height: 1920, durationSec: 62.1, fps: 30 });
  });

  it("applies rotation metadata so rotated phone footage reads as vertical", () => {
    expect(parseVideoStreamInfo(ROTATED)).toEqual({ width: 1080, height: 1920, durationSec: 14.9, fps: 29.97 });
  });

  it("returns null when there is no video stream", () => {
    expect(parseVideoStreamInfo("  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 128 kb/s")).toBeNull();
  });

  it("reads fractional source cadence rather than the nominal tbr", () => {
    const info = parseVideoStreamInfo(LANDSCAPE.replace("30 fps, 30 tbr", "59.94 fps, 60 tbr"));
    expect(info?.fps).toBe(59.94);
  });
});

describe("probeVideoStream with a signal", () => {
  it("does not start ffmpeg once the signal has already fired", async () => {
    spawned.calls = 0;

    await expect(probeVideoStream("clip.mp4", { signal: AbortSignal.abort() })).rejects.toBeInstanceOf(
      RenderCanceledError
    );
    expect(spawned.calls).toBe(0);
  });

  it("kills the ffmpeg it started when the signal fires, instead of waiting on a file that never answers", async () => {
    spawned.calls = 0;
    spawned.kills = 0;
    const controller = new AbortController();

    const probing = probeVideoStream("clip.mp4", { signal: controller.signal });
    controller.abort();

    await expect(probing).rejects.toBeInstanceOf(RenderCanceledError);
    expect(spawned.calls).toBe(1);
    expect(spawned.kills).toBe(1);
  });

  it("still reads the stream when no signal is given", async () => {
    const probing = probeVideoStream("clip.mp4");
    spawned.child?.emit("close", 0);

    await expect(probing).rejects.toThrow(/could not read the video dimensions/i);
  });
});

describe("runFfmpeg subprocess lifecycle and buffers", () => {
  it("cancels an abort that happened inside spawn before the listener was attached", async () => {
    const controller = new AbortController();
    spawned.onSpawn = () => controller.abort();

    await expect(runFfmpeg([], { signal: controller.signal })).rejects.toBeInstanceOf(RenderCanceledError);
    expect(spawned.calls).toBe(1);
    expect(spawned.kills).toBe(1);
  });

  it("streams more than the capture limit without retaining stdout and flushes the last record", async () => {
    let records = 0;
    const result = runFfmpeg([], { captureStdout: false, onStdoutLine: () => { records += 1; } });
    for (let i = 0; i < 220; i += 1) {
      spawned.child?.stdout.emit("data", "x".repeat(20_000) + "\n");
    }
    spawned.child?.stdout.emit("data", "last");
    spawned.child?.emit("close", 0);

    await expect(result).resolves.toMatchObject({ stdout: "", code: 0 });
    expect(records).toBe(221);
    expect(spawned.kills).toBe(0);
  });

  it("rejects explicitly and stops the child instead of silently truncating captured stdout", async () => {
    const result = runFfmpeg([]);
    const rejected = expect(result).rejects.toThrow(/stdout exceeded its capture limit/);
    spawned.child?.stdout.emit("data", "x".repeat(4 * 1024 * 1024 + 1));
    await rejected;
    expect(spawned.kills).toBe(1);
  });

  it.each(["stdout", "stderr"] as const)("bounds an unterminated %s callback line", async (stream) => {
    const result = runFfmpeg([], { onLine: () => undefined, onStdoutLine: () => undefined });
    const rejected = expect(result).rejects.toThrow(/oversized diagnostic line/);
    spawned.child?.[stream].emit("data", "x".repeat(64 * 1024));
    spawned.child?.[stream].emit("data", "x");
    await rejected;
    expect(spawned.kills).toBe(1);
  });

  it("turns a progress parser exception into a failed render and kills the child", async () => {
    const parserError = new Error("broken progress parser");
    const result = runFfmpeg([], { onLine: () => { throw parserError; } });
    const rejected = expect(result).rejects.toBe(parserError);
    expect(() => spawned.child?.stderr.emit("data", "frame=1\r")).not.toThrow();
    await rejected;
    expect(spawned.kills).toBe(1);
  });

  it("delivers CR/LF progress and a trailing record, then removes its abort listener", async () => {
    const controller = new AbortController();
    const onLine = vi.fn();
    const result = runFfmpeg([], { onLine, signal: controller.signal });
    spawned.child?.stderr.emit("data", "frame=1\rframe=2\nframe=");
    spawned.child?.stderr.emit("data", "3");
    spawned.child?.emit("close", 0);

    await expect(result).resolves.toMatchObject({ code: 0 });
    expect(onLine.mock.calls.map(([line]) => line)).toEqual(["frame=1", "frame=2", "frame=3"]);
    controller.abort();
    expect(spawned.kills).toBe(0);
  });

  it("cleans up on spawn errors and preserves the missing-binary message", async () => {
    const controller = new AbortController();
    const result = runFfmpeg([], { signal: controller.signal });
    const rejected = expect(result).rejects.toThrow(/FFmpeg is not available/);
    spawned.child?.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" }));
    await rejected;
    controller.abort();
    expect(spawned.kills).toBe(0);
  });
});
