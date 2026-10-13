import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { openZip, writeZip } from "@/lib/backup/zip";

const dirs: string[] = [];
function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "zip-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs.length = 0;
});

describe("zip archive", () => {
  it("round-trips text, binary and non-ascii names", async () => {
    const target = path.join(tempDir(), "a.zip");
    const binary = randomBytes(5000);
    const text = Buffer.from(JSON.stringify({ queue: Array.from({ length: 500 }, (_, i) => ({ id: i, title: "same title" })) }));
    const modified = new Date(2026, 9, 13, 3, 30, 10);

    const result = await writeZip(target, [
      { name: "data/queue.json", data: text, modified },
      { name: "data/clips/été.json", data: Buffer.from("{}") },
      { name: "data/blob.bin", data: binary },
      { name: "data/empty.json", data: Buffer.alloc(0) }
    ]);

    const archive = openZip(readFileSync(target));
    expect(result.entries).toBe(4);
    expect(archive.entries.map((entry) => entry.name)).toEqual([
      "data/queue.json",
      "data/clips/été.json",
      "data/blob.bin",
      "data/empty.json"
    ]);
    expect(archive.read("data/queue.json").equals(text)).toBe(true);
    expect(archive.read("data/blob.bin").equals(binary)).toBe(true);
    expect(archive.read("data/clips/été.json").toString()).toBe("{}");
    expect(archive.read("data/empty.json").length).toBe(0);
    expect(archive.entries[0].size).toBe(text.length);
    expect(archive.entries[0].modified.getFullYear()).toBe(2026);
    expect(archive.entries[0].modified.getMinutes()).toBe(30);
    expect(result.bytes).toBe(readFileSync(target).length);
  });

  it("compresses repetitive json", async () => {
    const target = path.join(tempDir(), "a.zip");
    const text = Buffer.from("x".repeat(200_000));
    await writeZip(target, [{ name: "data/x.json", data: text }]);
    expect(readFileSync(target).length).toBeLessThan(5000);
  });

  it("accepts entries from an async generator", async () => {
    const target = path.join(tempDir(), "a.zip");
    async function* entries() {
      yield { name: "one.json", data: Buffer.from("1") };
      yield { name: "two.json", data: Buffer.from("2") };
    }
    await writeZip(target, entries());
    expect(openZip(readFileSync(target)).entries.map((entry) => entry.name)).toEqual(["one.json", "two.json"]);
  });

  it("refuses a corrupted entry instead of returning bad bytes", async () => {
    const target = path.join(tempDir(), "a.zip");
    await writeZip(target, [{ name: "data/blob.bin", data: randomBytes(4000) }]);
    const bytes = readFileSync(target);
    bytes[200] ^= 0xff;
    writeFileSync(target, bytes);
    expect(() => openZip(readFileSync(target)).read("data/blob.bin")).toThrow(/checksum|corrupt/i);
  });

  it("rejects a file that is not a zip", () => {
    expect(() => openZip(Buffer.from("not a zip at all"))).toThrow(/zip/i);
  });
});
