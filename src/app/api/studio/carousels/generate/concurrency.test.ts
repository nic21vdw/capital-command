import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Carousel } from "@/types/domain";
import { defaultVideoStudio } from "@/lib/storage/schemas";

const generator = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("@/lib/studio/carousel", () => ({
  carouselGenerationConfigured: () => true, clampBatchCount: () => 1, DEFAULT_SLIDE_COUNT: 8,
  generateCarouselBatches: generator.generate, resolveSlideCount: vi.fn(), clipCarouselSource: vi.fn(),
}));
vi.mock("@/lib/longform/store", () => ({ getProject: vi.fn(), withFullTranscript: vi.fn() }));
vi.mock("@/lib/clipping/jobs", () => ({ getJob: vi.fn() }));

function deck(id: string): Carousel {
  return { id, title: id, sourceType: "custom", slides: [], createdAt: "2026-10-02T14:00:00.000Z" };
}

describe("concurrent carousel generation saves", () => {
  let dir: string;
  let previousDataDir: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "marketing-carousel-concurrency-"));
    previousDataDir = process.env.CAPITAL_COMMAND_DATA_DIR;
    process.env.CAPITAL_COMMAND_DATA_DIR = dir;
    vi.resetModules();
    generator.generate.mockReset();
  });
  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.CAPITAL_COMMAND_DATA_DIR;
    else process.env.CAPITAL_COMMAND_DATA_DIR = previousDataDir;
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps both decks and settings saved while both writers were waiting for their model", async () => {
    const { POST } = await import("@/app/api/studio/carousels/generate/route");
    const { readAppData, writeAppData, latestGoodSnapshot } = await import("@/lib/storage/store");
    const initial = await readAppData();
    await writeAppData({ ...initial, videoStudio: { ...(initial.videoStudio ?? defaultVideoStudio), carousels: [deck("existing")] } });

    const finish = new Map<string, (result: { carousels: Carousel[]; reason: null }) => void>();
    generator.generate.mockImplementation(({ sourceText }: { sourceText: string }) => new Promise((resolve) => {
      finish.set(sourceText, resolve);
    }));
    const request = (text: string) => new NextRequest("http://localhost:3100/api/studio/carousels/generate", {
      method: "POST", body: JSON.stringify({ text }),
    });
    const first = POST(request("first"));
    const second = POST(request("second"));
    await vi.waitFor(() => expect(finish.size).toBe(2));

    const edited = await readAppData();
    await writeAppData({
      ...edited, settings: { ...edited.settings, currency: "USD" },
      videoStudio: { ...(edited.videoStudio ?? defaultVideoStudio), framework: "Edited while the generators were writing" },
    });
    // Resolving both model calls in the same turn makes both routes try to
    // append together. Their saves must reread inside the shared write queue.
    finish.get("first")!({ carousels: [deck("first")], reason: null });
    finish.get("second")!({ carousels: [deck("second")], reason: null });
    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);

    const stored = await readAppData();
    expect(stored.videoStudio?.carousels.map((entry) => entry.id).sort()).toEqual(["existing", "first", "second"]);
    expect(stored.settings.currency).toBe("USD");
    expect(stored.videoStudio?.framework).toBe("Edited while the generators were writing");
    await vi.waitFor(async () => {
      const snapshot = await latestGoodSnapshot();
      expect(snapshot).not.toBeNull();
      const saved = JSON.parse(readFileSync(snapshot!.path, "utf8"));
      expect(saved.videoStudio.carousels).toHaveLength(3);
    });
  });
});
