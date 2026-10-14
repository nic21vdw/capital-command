import { rm } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";

beforeEach(async () => {
  await rm(dataPath("publisher-tokens.json"), { force: true });
  vi.resetModules();
});

describe("the publisher token store", () => {
  it("writes several keys in one go and reads them back", async () => {
    const { getCachedToken, setCachedTokens } = await import("@/lib/publisher/tokens");
    await setCachedTokens({ "a.token": "1", "a.expires": "2", "b.token": "3" });
    expect(await getCachedToken("a.token")).toBe("1");
    expect(await getCachedToken("a.expires")).toBe("2");
    expect(await getCachedToken("b.token")).toBe("3");
    expect(await getCachedToken("missing")).toBeNull();
  });

  it("does not lose a key when two writes are in flight together", async () => {
    const { getCachedToken, setCachedToken, setCachedTokens } = await import("@/lib/publisher/tokens");
    await Promise.all([
      setCachedToken("first", "1"),
      setCachedTokens({ second: "2", third: "3" }),
      setCachedToken("fourth", "4")
    ]);
    expect(await Promise.all(["first", "second", "third", "fourth"].map((key) => getCachedToken(key)))).toEqual(["1", "2", "3", "4"]);
  });

  it("keeps the other keys when one is overwritten", async () => {
    const { getCachedToken, setCachedToken } = await import("@/lib/publisher/tokens");
    await setCachedToken("keep", "k");
    await setCachedToken("change", "old");
    await setCachedToken("change", "new");
    expect(await getCachedToken("keep")).toBe("k");
    expect(await getCachedToken("change")).toBe("new");
  });
});
