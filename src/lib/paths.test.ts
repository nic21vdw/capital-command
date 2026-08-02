import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dataPath, dataRoot } from "@/lib/paths";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dataRoot", () => {
  it("sends the suite at a throwaway folder, never the checkout's own data", () => {
    expect(dataRoot()).toBe(process.env.CAPITAL_COMMAND_DATA_DIR);
    expect(dataRoot()).not.toBe(path.join(process.cwd(), "data"));
  });

  it("fails loudly rather than reading the live folder when the override is lost", () => {
    vi.stubEnv("CAPITAL_COMMAND_DATA_DIR", "");
    expect(() => dataRoot()).toThrow(/live data folder/);
  });

  it("builds paths inside the data folder", () => {
    expect(dataPath("publish-queue.json")).toBe(path.join(dataRoot(), "publish-queue.json"));
  });
});

describe("the publisher's token cache", () => {
  it("cannot see a refresh token that only exists next to the running app", async () => {
    const { publisherConfig } = await import("@/lib/publisher/config");
    const config = publisherConfig();
    expect(config.youtube.refreshToken).toBeNull();
    expect(config.tiktok.refreshToken).toBeNull();
  });
});
