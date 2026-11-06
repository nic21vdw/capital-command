import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createStoredMusicMediaReader, type StoredMusicRead } from "./editor-music-media";

function fixture() {
  const bytes = Buffer.alloc(44 + 800 * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  const copyBytes = vi.fn(() => Buffer.from(bytes));
  const verifyCurrent = vi.fn(async () => {});
  const asset: StoredMusicRead = { format: "wav", mimeType: "audio/wav", demuxer: "wav", byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), copyBytes, verifyCurrent };
  const resolveMusic = vi.fn(async (owner: string, mediaId: string) => owner === "owner-a" && mediaId === "music:exact" ? asset : null);
  return { bytes, asset, copyBytes, verifyCurrent, resolveMusic, read: createStoredMusicMediaReader({ resolveMusic }) };
}
const request = (method = "GET", headers: Record<string, string> = {}) => new Request("http://127.0.0.1:3100/api/integrations/marketing/media/music:exact", { method, headers });

describe("private stored-project music bytes", () => {
  it("returns only exact verified bytes with private headers and no source filename or cache validator", async () => {
    const f = fixture(); const response = await f.read("owner-a", "music:exact", request());
    expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(f.bytes);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("content-length")).toBe(String(f.bytes.length));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("etag")).toBeNull(); expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(f.verifyCurrent).toHaveBeenCalledTimes(2);
  });
  it("serves exact ranges and HEAD while verifying the grant before exposing byte counts", async () => {
    const f = fixture();
    const head = await f.read("owner-a", "music:exact", request("HEAD", { range: "bytes=44-63" }));
    expect(head.status).toBe(206); expect(await head.text()).toBe("");
    expect(head.headers.get("content-range")).toBe(`bytes 44-63/${f.bytes.length}`);
    expect(head.headers.get("content-length")).toBe("20"); expect(f.copyBytes).not.toHaveBeenCalled();
    expect(f.verifyCurrent).toHaveBeenCalledOnce();
    const ranged = await f.read("owner-a", "music:exact", request("GET", { range: "bytes=-9" }));
    expect(ranged.status).toBe(206); expect(Buffer.from(await ranged.arrayBuffer())).toEqual(f.bytes.subarray(-9));
  });
  it("returns whole bytes for If-Range without making a public conditional grant", async () => {
    const f = fixture(); const response = await f.read("owner-a", "music:exact", request("GET", { range: "bytes=2-5", "if-range": "untrusted" }));
    expect(response.status).toBe(200); expect(response.headers.get("content-range")).toBeNull();
    expect(Buffer.from(await response.arrayBuffer())).toEqual(f.bytes);
  });
  it("denies foreign and stale IDs before handling malformed ranges or HEAD", async () => {
    const f = fixture();
    for (const [owner, mediaId] of [["owner-b", "music:exact"], ["owner-a", "music:old"]]) {
      const response = await f.read(owner, mediaId, request("HEAD", { range: "bytes=99999-" }));
      expect(response.status).toBe(404); expect(response.headers.get("content-range")).toBeNull();
    }
    expect(f.verifyCurrent).not.toHaveBeenCalled(); expect(f.copyBytes).not.toHaveBeenCalled();
  });
  it("keeps malformed ranges private and rechecks current identity before a 416", async () => {
    const f = fixture(); const response = await f.read("owner-a", "music:exact", request("GET", { range: "bytes=999999-" }));
    expect(response.status).toBe(416); expect(response.headers.get("content-range")).toBe(`bytes */${f.bytes.length}`);
    expect(f.verifyCurrent).toHaveBeenCalledOnce(); expect(f.copyBytes).not.toHaveBeenCalled();
  });
  it("refuses a revoked project without exposing resolver errors or length", async () => {
    const f = fixture(); f.verifyCurrent.mockRejectedValue(new Error("synthetic-private-detail"));
    for (const method of ["GET", "HEAD"]) {
      const response = await f.read("owner-a", "music:exact", request(method, { range: "bytes=1-2" }));
      expect(response.status).toBe(404); expect(await response.text()).toBe("");
      expect(response.headers.get("content-length")).toBeNull();
    }
    expect(f.copyBytes).not.toHaveBeenCalled();
  });
  it("refuses byte substitution and rechecks revocation after copying", async () => {
    const changed = fixture(); changed.copyBytes.mockReturnValue(Buffer.alloc(changed.bytes.length));
    expect((await changed.read("owner-a", "music:exact", request())).status).toBe(404);
    const revoked = fixture(); revoked.copyBytes.mockImplementation(() => {
      revoked.verifyCurrent.mockRejectedValue(new Error("changed after copy")); return Buffer.from(revoked.bytes);
    });
    expect((await revoked.read("owner-a", "music:exact", request())).status).toBe(404);
  });
  it.each([{ format: "mp3" }, { mimeType: "text/html" }, { demuxer: "hls" }, { byteLength: 8 * 1024 * 1024 + 1 },
    { byteLength: 1 }, { sha256: "unverified" }])("does not broaden the trusted WAV grant: %j", async (changed) => {
    const f = fixture(); Object.assign(f.asset, changed);
    expect((await f.read("owner-a", "music:exact", request())).status).toBe(404);
    expect(f.copyBytes).not.toHaveBeenCalled();
  });
  it("never treats a write method as a read or allocates an unbounded identifier", async () => {
    const f = fixture(); const denied = await f.read("owner-a", "music:exact", request("POST"));
    expect(denied.status).toBe(405); expect(denied.headers.get("allow")).toBe("GET, HEAD");
    expect(f.copyBytes).not.toHaveBeenCalled(); f.resolveMusic.mockClear();
    expect((await f.read("owner-a", "x".repeat(513), request())).status).toBe(404);
    expect(f.resolveMusic).not.toHaveBeenCalled();
  });
});
