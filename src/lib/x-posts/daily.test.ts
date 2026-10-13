import { beforeEach, describe, expect, it, vi } from "vitest";
import type { XDailyPack } from "@/types/domain";

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/storage/store", () => ({ readAppData: mocks.read, writeAppData: mocks.write }));
vi.mock("@/lib/x-posts/generator", () => ({ generateDailyPack: mocks.generate }));

import { ensureDailyPack } from "@/lib/x-posts/daily";

const DATE = "2026-10-11";
function pack(source: "ai" | "library", posts = 6): XDailyPack {
  return { id: `p-${source}`, date: DATE, source, posts: Array.from({ length: posts }, (_, i) => ({ topic: `t${i}` })), replies: [], createdAt: "2026-10-11T12:00:00.000Z" } as unknown as XDailyPack;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ xStrategy: { brief: "" }, xPlanner: { packs: [pack("ai")] } });
});

describe("ensureDailyPack rewrite", () => {
  it("replaces a written pack with a fresh written one", async () => {
    mocks.generate.mockResolvedValue({ pack: { ...pack("ai"), id: "fresh" }, reason: null });
    const result = await ensureDailyPack({ date: DATE, force: true, keepWritten: true });
    expect(result.cached).toBe(false);
    expect(result.pack.id).toBe("fresh");
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("keeps the written pack instead of swapping in the idea library when asked to", async () => {
    mocks.generate.mockResolvedValue({ pack: pack("library", 24), reason: "AI is not configured." });
    const result = await ensureDailyPack({ date: DATE, force: true, keepWritten: true });
    expect(result.cached).toBe(true);
    expect(result.pack.id).toBe("p-ai");
    expect(result.reason).toContain("Kept today's pack");
    expect(result.reason).toContain("AI is not configured.");
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("still lets the idea library in when nothing was written, or when not asked to keep", async () => {
    mocks.generate.mockResolvedValue({ pack: pack("library", 24), reason: "AI is not configured." });
    expect((await ensureDailyPack({ date: DATE, force: true })).cached).toBe(false);
    mocks.read.mockResolvedValue({ xStrategy: { brief: "" }, xPlanner: { packs: [] } });
    expect((await ensureDailyPack({ date: DATE, force: true, keepWritten: true })).cached).toBe(false);
  });
});
