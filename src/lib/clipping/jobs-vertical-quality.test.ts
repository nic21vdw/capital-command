import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";

const media = vi.hoisted(() => ({ render: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined) }));
vi.mock("@/lib/clipping/ffmpeg", () => ({
  probeDimensions: async () => ({ width: 2160, height: 3840 }),
  probeVideoStream: async () => ({ width: 2160, height: 3840, fps: 59.94 }),
  hasAudioStream: async () => true
}));
vi.mock("@/lib/clipping/autoframe", () => ({
  DOWNLOAD_FRAME_W: 1080,
  DOWNLOAD_FRAME_H: 1920,
  planClipFraming: async () => null
}));
vi.mock("@/lib/clipping/render", () => ({ renderCaptionedVertical: media.render }));

const { ensureVerticalClipFile, workDir } = await import("./jobs");

beforeAll(async () => {
  const file = dataPath("clips", "jobs.json");
  const base = {
    status: "done", stage: "finished", progress: 100, notices: [],
    createdAt: "2026-10-01T12:00:00.000Z",
    output: { resolution: "2160", frameRate: "source" }
  };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify([
    { ...base, id: "portrait-ready", clips: [{ id: "c1", start: 0, end: 10, file: "master.mp4", downloadFile: "ready.mp4" }] },
    { ...base, id: "portrait-fallback", clips: [{ id: "c2", title: "Native 4K", start: 0, end: 10, file: "master.mp4" }] }
  ]));
  await mkdir(workDir("portrait-fallback"), { recursive: true });
});

beforeEach(() => media.render.mockClear());

describe("native portrait masters keep their ready-to-post captions", () => {
  it("reuses the captioned delivery file instead of bypassing it for a vertical master", async () => {
    expect(await ensureVerticalClipFile("portrait-ready", "master.mp4")).toBe("ready.mp4");
    expect(media.render).not.toHaveBeenCalled();
  });

  it("creates a captioned 4K fallback with the original fractional frame rate", async () => {
    expect(await ensureVerticalClipFile("portrait-fallback", "master.mp4")).toBe("master-vertical.mp4");
    expect(media.render).toHaveBeenCalledOnce();
    const args = media.render.mock.calls[0];
    expect(args[7]).toEqual({ width: 2160, height: 3840, fps: 59.94 });
    const captions = await readFile(args[2] as string, "utf8");
    expect(captions).toContain("PlayResX: 2160");
    expect(captions).toContain("PlayResY: 3840");
  });
});
