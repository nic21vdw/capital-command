import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appleEmojiBytes } from "@/lib/carousels/emojiFiles";
import { dataPath } from "@/lib/paths";

/**
 * The disk cache the server draws emoji from. Its whole job is that a publish
 * run never waits on a CDN twice — and never trusts a file a killed release
 * left half written.
 */

const cacheRoot = dataPath("emoji-apple");
const fetchMock = vi.fn();

function png(bytes: Uint8Array) {
  return {
    ok: true,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
}

beforeEach(async () => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  await mkdir(cacheRoot, { recursive: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("appleEmojiBytes", () => {
  it("downloads a glyph once and reads it from disk after", async () => {
    fetchMock.mockResolvedValue(png(new Uint8Array([1, 2, 3])));
    expect(await appleEmojiBytes("🚀")).toEqual(Buffer.from([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await appleEmojiBytes("🚀")).toEqual(Buffer.from([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves no temporary file behind", async () => {
    fetchMock.mockResolvedValue(png(new Uint8Array([4])));
    await appleEmojiBytes("🔥");
    expect((await readdir(cacheRoot)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("treats a zero-length cached file as a miss, not as a blank emoji", async () => {
    // What a release that tree-kills the server mid-write leaves behind.
    await writeFile(path.join(cacheRoot, "1f9e0.png"), Buffer.alloc(0));
    fetchMock.mockResolvedValue(png(new Uint8Array([9, 9])));
    expect(await appleEmojiBytes("🧠")).toEqual(Buffer.from([9, 9]));
    expect(await readFile(path.join(cacheRoot, "1f9e0.png"))).toEqual(Buffer.from([9, 9]));
  });

  it("gives up quietly when the body read fails after the headers arrived", async () => {
    fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => { throw new Error("socket hang up"); } });
    await expect(appleEmojiBytes("📈")).resolves.toBeNull();
  });

  it("gives up quietly when the request itself fails", async () => {
    fetchMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(appleEmojiBytes("💡")).resolves.toBeNull();
  });

  it("tries the next candidate name when the first is not there", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 }).mockResolvedValueOnce(png(new Uint8Array([7])));
    expect(await appleEmojiBytes("🛠️")).toEqual(Buffer.from([7]));
    expect(fetchMock.mock.calls[0][0]).toContain("1f6e0.png");
    expect(fetchMock.mock.calls[1][0]).toContain("1f6e0-fe0f.png");
  });

  it("does not ask again for a glyph the set does not have", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    expect(await appleEmojiBytes("🫩")).toBeNull();
    const asked = fetchMock.mock.calls.length;
    expect(await appleEmojiBytes("🫩")).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(asked);
  });
});
