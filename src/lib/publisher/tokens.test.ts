import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";

const FILE = dataPath("publisher-tokens.json");
const EXISTING = JSON.stringify({ "youtube.refreshToken": "yt-refresh", "tiktok.refreshToken": "tt-refresh" }, null, 2);

beforeEach(async () => {
  await rm(FILE, { force: true });
  await rm(`${FILE}.lock`, { force: true });
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.doUnmock("@/lib/storage/atomic-json");
});

async function seed(text = EXISTING) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, text, "utf8");
}

async function failReadsOf(code: string, times = Number.POSITIVE_INFINITY) {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  let reads = 0;
  vi.doMock("node:fs/promises", () => ({
    ...actual,
    default: actual,
    readFile: vi.fn(async (file: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
      if (String(file).endsWith("publisher-tokens.json")) {
        reads += 1;
        if (reads <= times) throw Object.assign(new Error(`${code}: resource busy or locked`), { code });
      }
      return (actual.readFile as (...args: unknown[]) => Promise<unknown>)(file, ...rest);
    })
  }));
  return { reads: () => reads };
}

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

  it("starts an empty store when the file does not exist yet", async () => {
    const { getCachedToken, setCachedToken } = await import("@/lib/publisher/tokens");
    expect(existsSync(FILE)).toBe(false);
    await setCachedToken("first", "1");
    expect(await getCachedToken("first")).toBe("1");
  });
});

describe("a token file that cannot be read", () => {
  it("is never rewritten when the read fails with EBUSY, so the other tokens survive", async () => {
    await seed();
    await failReadsOf("EBUSY");
    const { setCachedTokens, setCachedToken } = await import("@/lib/publisher/tokens");

    await expect(setCachedTokens({ "linkedin.accessToken": "li" })).rejects.toThrow("EBUSY");
    await expect(setCachedToken("linkedin.author", "urn:li:person:abc")).rejects.toThrow("EBUSY");

    expect(await readFile(FILE, "utf8")).toBe(EXISTING);
    expect((await readdir(path.dirname(FILE))).filter((name) => name.startsWith("publisher-tokens.json") && name !== "publisher-tokens.json")).toEqual([]);
  });

  it("is never rewritten when it holds something that is not a JSON object", async () => {
    await seed("{ this is not json");
    const { getCachedToken, setCachedTokens } = await import("@/lib/publisher/tokens");

    await expect(setCachedTokens({ "linkedin.accessToken": "li" })).rejects.toThrow("publisher-tokens.json");
    expect(await readFile(FILE, "utf8")).toBe("{ this is not json");
    expect(await getCachedToken("anything")).toBeNull();
  });

  it("reads as empty rather than throwing, so a post fails as not connected instead of crashing", async () => {
    await seed();
    await failReadsOf("EBUSY");
    const { getCachedToken } = await import("@/lib/publisher/tokens");
    expect(await getCachedToken("youtube.refreshToken")).toBeNull();
  });

  it("writes again, keeping everything, once the file can be read", async () => {
    await seed();
    const { getCachedToken, setCachedTokens } = await import("@/lib/publisher/tokens");
    await setCachedTokens({ "linkedin.accessToken": "li" });
    expect(await getCachedToken("youtube.refreshToken")).toBe("yt-refresh");
    expect(await getCachedToken("tiktok.refreshToken")).toBe("tt-refresh");
    expect(await getCachedToken("linkedin.accessToken")).toBe("li");
  });
});

describe("a token file that is locked for a moment", () => {
  it.each(["EBUSY", "EPERM", "EACCES"])("is read again after %s, and then the write keeps every token", async (code) => {
    await seed();
    const probe = await failReadsOf(code, 2);
    const { getCachedToken, setCachedTokens } = await import("@/lib/publisher/tokens");

    await setCachedTokens({ "linkedin.accessToken": "li" });

    expect(probe.reads()).toBe(3);
    expect(await getCachedToken("youtube.refreshToken")).toBe("yt-refresh");
    expect(await getCachedToken("tiktok.refreshToken")).toBe("tt-refresh");
    expect(await getCachedToken("linkedin.accessToken")).toBe("li");
  });

  it("tries five times and then gives up without writing", async () => {
    await seed();
    const probe = await failReadsOf("EBUSY");
    const { setCachedTokens } = await import("@/lib/publisher/tokens");

    await expect(setCachedTokens({ "linkedin.accessToken": "li" })).rejects.toThrow("EBUSY");

    expect(probe.reads()).toBe(5);
    expect(await readFile(FILE, "utf8")).toBe(EXISTING);
  });

  it("succeeds on the fifth attempt", async () => {
    await seed();
    const probe = await failReadsOf("EBUSY", 4);
    const { getCachedToken, setCachedTokens } = await import("@/lib/publisher/tokens");
    await setCachedTokens({ "linkedin.accessToken": "li" });
    expect(probe.reads()).toBe(5);
    expect(await getCachedToken("youtube.refreshToken")).toBe("yt-refresh");
  });

  it("does not wait on an error that is not a lock", async () => {
    await seed();
    const probe = await failReadsOf("EIO");
    const { setCachedTokens } = await import("@/lib/publisher/tokens");
    await expect(setCachedTokens({ "linkedin.accessToken": "li" })).rejects.toThrow("EIO");
    expect(probe.reads()).toBe(1);
    expect(await readFile(FILE, "utf8")).toBe(EXISTING);
  });

  it("does not retry a file that is simply not there", async () => {
    const probe = await failReadsOf("ENOENT", 1);
    const { getCachedToken, setCachedTokens } = await import("@/lib/publisher/tokens");
    await setCachedTokens({ first: "1" });
    expect(probe.reads()).toBe(1);
    expect(await getCachedToken("first")).toBe("1");
  });

  it("lets a plain read ride out the same lock", async () => {
    await seed();
    await failReadsOf("EBUSY", 3);
    const { getCachedToken } = await import("@/lib/publisher/tokens");
    expect(await getCachedToken("youtube.refreshToken")).toBe("yt-refresh");
  });
});

describe("the token file lock", () => {
  it("is held while the file is swapped, and released afterwards", async () => {
    await seed();
    const actual = await vi.importActual<typeof import("@/lib/storage/atomic-json")>("@/lib/storage/atomic-json");
    const lockedDuringWrite: boolean[] = [];
    vi.doMock("@/lib/storage/atomic-json", () => ({
      ...actual,
      atomicWriteFile: vi.fn(async (...args: Parameters<typeof actual.atomicWriteFile>) => {
        lockedDuringWrite.push(existsSync(`${FILE}.lock`));
        return actual.atomicWriteFile(...args);
      })
    }));
    const { setCachedTokens } = await import("@/lib/publisher/tokens");

    await setCachedTokens({ "linkedin.accessToken": "li" });

    expect(lockedDuringWrite).toEqual([true]);
    expect(existsSync(`${FILE}.lock`)).toBe(false);
  });

  it("makes a read-modify-write one step, so two of them cannot both take the same entry", async () => {
    const { getCachedToken, setCachedTokens, updateCachedTokens } = await import("@/lib/publisher/tokens");
    await setCachedTokens({ pending: "one" });
    const take = () =>
      updateCachedTokens((current) => {
        const taken = current.pending === "one";
        return { set: taken ? { pending: "" } : ({} as Record<string, string>), result: taken };
      });

    const results = await Promise.all([take(), take(), take()]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await getCachedToken("pending")).toBeFalsy();
  });
});
