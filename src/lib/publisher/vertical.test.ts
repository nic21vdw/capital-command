import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareVerticalMedia, verticalRenderPath } from "@/lib/publisher/vertical";

/**
 * The pre-post vertical gate: vertical/square sources pass through untouched,
 * landscape sources are re-rendered 9:16 (and the render is cached), and a
 * YouTube post longer than the Shorts limit is refused outright.
 */

vi.mock("@/lib/clipping/ffmpeg", () => ({
  probeVideoStream: vi.fn(),
  hasAudioStream: vi.fn(async () => true)
}));
vi.mock("@/lib/clipping/render", () => ({
  renderVertical: vi.fn(async (_input: string, output: string) => {
    const { writeFile: write } = await import("node:fs/promises");
    await write(output, "rendered");
  })
}));

import { probeVideoStream } from "@/lib/clipping/ffmpeg";
import { renderVertical } from "@/lib/clipping/render";

const probe = vi.mocked(probeVideoStream);
const render = vi.mocked(renderVertical);

let clipPath: string;

beforeEach(async () => {
  vi.clearAllMocks();
  const dir = path.join(os.tmpdir(), `publisher-vertical-test-${process.pid}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  clipPath = path.join(dir, "clip.mp4");
  await writeFile(clipPath, Buffer.alloc(1024, 3));
});

describe("prepareVerticalMedia", () => {
  it("passes a vertical source through untouched", async () => {
    probe.mockResolvedValue({ width: 1080, height: 1920, durationSec: 30 });

    const prepared = await prepareVerticalMedia(clipPath, ["youtube"]);

    expect(prepared).toEqual({ path: clipPath, converted: false });
    expect(render).not.toHaveBeenCalled();
  });

  it("passes a square source through untouched", async () => {
    probe.mockResolvedValue({ width: 1080, height: 1080, durationSec: 30 });

    const prepared = await prepareVerticalMedia(clipPath, ["youtube"]);

    expect(prepared.converted).toBe(false);
  });

  it("re-renders a landscape source to the cached 9:16 sibling", async () => {
    probe.mockResolvedValue({ width: 1920, height: 1080, durationSec: 30 });

    const prepared = await prepareVerticalMedia(clipPath, ["youtube"]);

    expect(prepared.converted).toBe(true);
    expect(prepared.path).toBe(verticalRenderPath(clipPath));
    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(clipPath, verticalRenderPath(clipPath), true);
  });

  it("reuses the cached vertical render on subsequent posts", async () => {
    probe.mockResolvedValue({ width: 1920, height: 1080, durationSec: 30 });

    await prepareVerticalMedia(clipPath, ["youtube"]);
    const again = await prepareVerticalMedia(clipPath, ["tiktok"]);

    expect(again.path).toBe(verticalRenderPath(clipPath));
    expect(render).toHaveBeenCalledOnce();
  });

  it("refuses a YouTube post longer than the Shorts limit", async () => {
    probe.mockResolvedValue({ width: 1080, height: 1920, durationSec: 200 });

    await expect(prepareVerticalMedia(clipPath, ["youtube"])).rejects.toThrow(/Shorts/);
    expect(render).not.toHaveBeenCalled();
  });

  it("does not apply the Shorts duration limit to non-YouTube posts", async () => {
    probe.mockResolvedValue({ width: 1080, height: 1920, durationSec: 200 });

    const prepared = await prepareVerticalMedia(clipPath, ["tiktok", "instagram"]);

    expect(prepared.converted).toBe(false);
  });
});
