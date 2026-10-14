import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, default: actual, rename: vi.fn(actual.rename), readFile: vi.fn(actual.readFile) };
});

import * as fsp from "node:fs/promises";
import { EnvWriteError, writeEnvValues } from "@/lib/envFile";
import { PUBLIC_BASE_URL_KEY, writePublicBaseUrl } from "@/lib/podcast/publicUrl";

const rename = vi.mocked(fsp.rename);
const readFileMock = vi.mocked(fsp.readFile);
const realRename = rename.getMockImplementation()!;
const realReadFile = readFileMock.getMockImplementation()!;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated`), { code });
}

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "cc-envfile-"));
  file = path.join(dir, ".env");
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  rename.mockReset().mockImplementation(realRename);
  readFileMock.mockReset().mockImplementation(realReadFile);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete process.env[PUBLIC_BASE_URL_KEY];
  await rm(dir, { recursive: true, force: true });
});

function slowEnvReads() {
  readFileMock.mockImplementation((async (...args: Parameters<typeof realReadFile>) => {
    const contents = await realReadFile(...args);
    if (String(args[0]).endsWith(".env")) await sleep(40);
    return contents;
  }) as typeof realReadFile);
}

describe("writeEnvValues", () => {
  it("keeps both changes when two writes overlap", async () => {
    await writeFile(file, "A=1\nB=1\n", "utf8");
    slowEnvReads();
    const env: Record<string, string | undefined> = {};

    await Promise.all([writeEnvValues({ A: "2" }, { file, env }), writeEnvValues({ B: "2" }, { file, env })]);

    expect(await readFile(file, "utf8")).toBe("A=2\nB=2\n");
  });

  it("keeps both changes when a public-address save overlaps another setting", async () => {
    await writeFile(file, "PUBLISH_ENABLED=false\nS3_REGION=auto\n", "utf8");
    slowEnvReads();

    await Promise.all([
      writePublicBaseUrl("https://pub-1.r2.dev"),
      writeEnvValues({ PUBLISH_ENABLED: "true" }, { file, env: {} })
    ]);

    const after = await readFile(file, "utf8");
    expect(after).toContain("PUBLISH_ENABLED=true");
    expect(after).toContain(`${PUBLIC_BASE_URL_KEY}=https://pub-1.r2.dev`);
    expect(after).toContain("S3_REGION=auto");
  });

  it("applies overlapping writes of the same key in the order they were made", async () => {
    await writeFile(file, "A=0\n", "utf8");
    slowEnvReads();

    await Promise.all(["1", "2", "3"].map((value) => writeEnvValues({ A: value }, { file, env: {} })));

    expect(await readFile(file, "utf8")).toBe("A=3\n");
  });

  it("leaves .env exactly as it was, and the live environment alone, when the swap fails", async () => {
    await writeFile(file, "SECRET=keep-me\nA=1\n", "utf8");
    rename.mockRejectedValue(errno("ENOSPC"));
    const env: Record<string, string | undefined> = {};

    await expect(writeEnvValues({ A: "2" }, { file, env })).rejects.toBeInstanceOf(EnvWriteError);

    expect(await readFile(file, "utf8")).toBe("SECRET=keep-me\nA=1\n");
    expect(env).toEqual({});
    expect(await readdir(dir)).toEqual([".env"]);
  });

  it("never writes .env directly when every swap attempt hits EPERM", async () => {
    await writeFile(file, "SECRET=keep-me\nA=1\n", "utf8");
    rename.mockRejectedValue(errno("EPERM"));

    await expect(writeEnvValues({ A: "2" }, { file, env: {} })).rejects.toBeInstanceOf(EnvWriteError);

    expect(await readFile(file, "utf8")).toBe("SECRET=keep-me\nA=1\n");
    expect(await readdir(dir)).toEqual([".env"]);
  }, 30_000);

  it("leaves .env as it was when a public-address save cannot swap the file in", async () => {
    await writeFile(file, "SECRET=keep-me\n", "utf8");
    rename.mockRejectedValue(errno("ENOSPC"));

    await expect(writePublicBaseUrl("https://pub-1.r2.dev")).rejects.toMatchObject({ code: "ENOSPC" });

    expect(await readFile(file, "utf8")).toBe("SECRET=keep-me\n");
    expect(process.env[PUBLIC_BASE_URL_KEY]).toBeUndefined();
  });

  it("does not replace a .env it could not read", async () => {
    await writeFile(file, "SECRET=keep-me\n", "utf8");
    readFileMock.mockImplementation((async (...args: Parameters<typeof realReadFile>) => {
      if (String(args[0]).endsWith(".env")) throw errno("EBUSY");
      return realReadFile(...args);
    }) as typeof realReadFile);

    await expect(writePublicBaseUrl("https://pub-1.r2.dev")).rejects.toMatchObject({ code: "EBUSY" });

    readFileMock.mockImplementation(realReadFile);
    expect(await readFile(file, "utf8")).toBe("SECRET=keep-me\n");
  });

  it("rewrites every duplicate assignment of a key and leaves commented ones alone", async () => {
    await writeFile(file, ["A=1", "# A=commented", "B=keep", "export A=2", "A=3", ""].join("\n"), "utf8");

    await writeEnvValues({ A: "9" }, { file, env: {} });

    expect(await readFile(file, "utf8")).toBe(["A=9", "# A=commented", "B=keep", "export A=9", "A=9", ""].join("\n"));
  });

  it("keeps comments, CRLF line endings and the byte-order mark", async () => {
    const before = "﻿# settings\r\nA=1\r\n\r\nSECRET=keep-me\r\n";
    await writeFile(file, before, "utf8");

    await writeEnvValues({ A: "2", NEW: "x" }, { file, env: {} });

    const bytes = await readFile(file);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString("utf8")).toBe("﻿# settings\r\nA=2\r\n\r\nSECRET=keep-me\r\nNEW=x\r\n");
  });

  it("creates .env when there is none", async () => {
    const env: Record<string, string | undefined> = {};
    await writeEnvValues({ A: "1" }, { file, env });
    expect(await readFile(file, "utf8")).toBe("A=1\n");
    expect(env.A).toBe("1");
  });
});
