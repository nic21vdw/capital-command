import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawn, stat, mkdir, chmod, rename, rm, createWriteStream, pipeline } = vi.hoisted(() => ({
  spawn: vi.fn(), stat: vi.fn(), mkdir: vi.fn(), chmod: vi.fn(),
  rename: vi.fn(), rm: vi.fn(), createWriteStream: vi.fn(), pipeline: vi.fn()
}));
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("node:fs", () => ({ createWriteStream, mkdirSync: vi.fn() }));
vi.mock("node:fs/promises", () => ({ stat, mkdir, chmod, rename, rm, readdir: vi.fn() }));
vi.mock("node:stream/promises", () => ({ pipeline }));
vi.mock("@/lib/clipping/ffmpeg", () => ({ resolveFfmpeg: () => null }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  stat.mockRejectedValue(new Error("missing"));
  mkdir.mockResolvedValue(undefined);
  chmod.mockResolvedValue(undefined);
  rename.mockResolvedValue(undefined);
  rm.mockResolvedValue(undefined);
  createWriteStream.mockReturnValue({});
  pipeline.mockResolvedValue(undefined);
  spawn.mockImplementation(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("error", new Error("not installed")));
    return child;
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("binary")));
});

afterEach(() => vi.unstubAllGlobals());

describe("yt-dlp first-use initialization", () => {
  it("shares one probe/download across concurrent callers", async () => {
    const { ensureYtDlp } = await import("./download");
    const results = await Promise.all([ensureYtDlp(), ensureYtDlp(), ensureYtDlp()]);

    expect(new Set(results).size).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(pipeline).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledTimes(process.platform === "win32" ? 2 : 1);
    await expect(ensureYtDlp()).resolves.toBe(results[0]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("removes a failed partial download and allows the next job to retry", async () => {
    pipeline.mockRejectedValueOnce(new Error("stream interrupted"));
    const { ensureYtDlp } = await import("./download");

    await expect(ensureYtDlp()).rejects.toThrow("stream interrupted");
    expect(rename).not.toHaveBeenCalled();
    expect(rm).toHaveBeenCalledWith(expect.stringMatching(/\.partial$/), { force: true });

    await expect(ensureYtDlp()).resolves.toEqual(expect.any(String));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(rename).toHaveBeenCalledTimes(1);
  });
});
