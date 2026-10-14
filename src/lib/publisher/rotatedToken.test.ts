import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";

beforeEach(async () => {
  await rm(dataPath("publisher-tokens.json"), { force: true });
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/storage/atomic-json");
  vi.restoreAllMocks();
});

async function failWrites() {
  const actual = await vi.importActual<typeof import("@/lib/storage/atomic-json")>("@/lib/storage/atomic-json");
  vi.doMock("@/lib/storage/atomic-json", () => ({
    ...actual,
    atomicWriteFile: vi.fn(async () => {
      throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    })
  }));
  vi.resetModules();
}

describe("saving a refresh token the provider rotated", () => {
  it("stores it and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { saveRotatedToken } = await import("@/lib/publisher/rotatedToken");
    const { getCachedToken } = await import("@/lib/publisher/tokens");

    expect(await saveRotatedToken("TikTok", "tiktok.refreshToken", "new")).toBe(true);

    expect(await getCachedToken("tiktok.refreshToken")).toBe("new");
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs a failed save, names the provider and the reason, and does not throw", async () => {
    await failWrites();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { saveRotatedToken } = await import("@/lib/publisher/rotatedToken");

    expect(await saveRotatedToken("TikTok", "tiktok.refreshToken", "new")).toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("TikTok");
    expect(line).toContain("EBUSY");
    expect(line).toContain("reconnect");
  });
});
