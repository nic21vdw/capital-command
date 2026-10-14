import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, default: actual, rename: vi.fn(actual.rename), open: vi.fn(actual.open) };
});

import * as fsp from "node:fs/promises";
import { atomicWriteFile, atomicWriteJson, readJson } from "@/lib/storage/atomic-json";

const rename = vi.mocked(fsp.rename);
const open = vi.mocked(fsp.open);
const realRename = rename.getMockImplementation()!;
const realOpen = open.getMockImplementation()!;

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated`), { code });
}

let dir: string;
let target: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "atomic-json-"));
  target = path.join(dir, "state.json");
  rename.mockReset().mockImplementation(realRename);
  open.mockReset().mockImplementation(realOpen);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

async function leftovers() {
  return (await readdir(dir)).filter((name) => name !== "state.json");
}

describe("atomicWriteJson", () => {
  it("writes the value, creating the folder, and leaves nothing else behind", async () => {
    const nested = path.join(dir, "a", "b", "state.json");
    await atomicWriteJson(nested, { items: [1, 2, 3] });
    expect(JSON.parse(await readFile(nested, "utf8"))).toEqual({ items: [1, 2, 3] });
    expect(await readdir(path.dirname(nested))).toEqual(["state.json"]);
  });

  it("pretty-prints by default and compacts on request", async () => {
    await atomicWriteJson(target, { a: 1 });
    expect(await readFile(target, "utf8")).toBe('{\n  "a": 1\n}');
    await atomicWriteJson(target, { a: 1 }, { space: 0 });
    expect(await readFile(target, "utf8")).toBe('{"a":1}');
  });

  it("flushes the temporary file to disk before it swaps it in", async () => {
    const order: string[] = [];
    open.mockImplementation(async (...args: Parameters<typeof realOpen>) => {
      const handle = await realOpen(...args);
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        order.push("sync");
        return sync();
      };
      return handle;
    });
    rename.mockImplementation(async (...args: Parameters<typeof realRename>) => {
      order.push("rename");
      return realRename(...args);
    });

    await atomicWriteJson(target, { ok: true });
    expect(order).toEqual(["sync", "rename"]);
  });

  it("removes its temporary file when the rename fails", async () => {
    await writeFile(target, '{"old":true}', "utf8");
    rename.mockRejectedValue(errno("ENOSPC"));

    await expect(atomicWriteJson(target, { fresh: true })).rejects.toMatchObject({ code: "ENOSPC" });

    expect(await leftovers()).toEqual([]);
    expect(await readFile(target, "utf8")).toBe('{"old":true}');
  });

  it("removes its temporary file when the write itself fails", async () => {
    await writeFile(target, '{"old":true}', "utf8");
    open.mockImplementation(async (...args: Parameters<typeof realOpen>) => {
      const handle = await realOpen(...args);
      handle.writeFile = async () => {
        throw errno("ENOSPC");
      };
      return handle;
    });

    await expect(atomicWriteJson(target, { fresh: true })).rejects.toMatchObject({ code: "ENOSPC" });

    expect(await leftovers()).toEqual([]);
    expect(await readFile(target, "utf8")).toBe('{"old":true}');
  });

  it("never writes the target directly when every rename attempt hits EPERM", async () => {
    await writeFile(target, '{"old":true}', "utf8");
    rename.mockRejectedValue(errno("EPERM"));

    await expect(atomicWriteJson(target, { fresh: true }, { backoffMs: 1 })).rejects.toMatchObject({ code: "EPERM" });

    expect(rename.mock.calls.length).toBeGreaterThan(1);
    expect(await readFile(target, "utf8")).toBe('{"old":true}');
    expect(await leftovers()).toEqual([]);
  });

  it("gives up after a bounded number of attempts", async () => {
    rename.mockRejectedValue(errno("EBUSY"));
    await expect(atomicWriteJson(target, {}, { attempts: 3, backoffMs: 1 })).rejects.toMatchObject({ code: "EBUSY" });
    expect(rename).toHaveBeenCalledTimes(3);
  });

  it.each(["EPERM", "EBUSY", "EACCES"])("retries %s and succeeds once the file is free", async (code) => {
    let failures = 2;
    rename.mockImplementation(async (...args: Parameters<typeof realRename>) => {
      if (failures-- > 0) throw errno(code);
      return realRename(...args);
    });

    await atomicWriteJson(target, { fresh: true }, { backoffMs: 1 });

    expect(rename).toHaveBeenCalledTimes(3);
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ fresh: true });
    expect(await leftovers()).toEqual([]);
  });

  it("does not retry an error that waiting cannot fix", async () => {
    rename.mockRejectedValue(errno("ENOENT"));
    await expect(atomicWriteJson(target, {}, { backoffMs: 1 })).rejects.toMatchObject({ code: "ENOENT" });
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it("uses a different temporary name for every write", async () => {
    const seen = new Set<string>();
    rename.mockImplementation(async (...args: Parameters<typeof realRename>) => {
      seen.add(String(args[0]));
      return realRename(...args);
    });
    await Promise.all([1, 2, 3, 4].map((n) => atomicWriteJson(target, { n })));
    expect(seen.size).toBe(4);
    expect([...seen].every((name) => path.dirname(name) === dir && name.endsWith(".tmp"))).toBe(true);
  });

  it("writes text and raw bytes too", async () => {
    await atomicWriteFile(target, "plain text");
    expect(await readFile(target, "utf8")).toBe("plain text");
    await atomicWriteFile(target, new Uint8Array([137, 80, 78, 71]));
    expect([...(await readFile(target))]).toEqual([137, 80, 78, 71]);
  });
});

describe("readJson", () => {
  it("returns null for a missing file", async () => {
    expect(await readJson(path.join(dir, "absent.json"))).toBeNull();
  });

  it("returns the parsed value", async () => {
    await writeFile(target, '{"a":[1]}', "utf8");
    expect(await readJson(target)).toEqual({ a: [1] });
  });

  it("throws on a file that exists but cannot be parsed, naming the file", async () => {
    await writeFile(target, "{ half", "utf8");
    await expect(readJson(target)).rejects.toThrow(/state\.json/);
  });
});
