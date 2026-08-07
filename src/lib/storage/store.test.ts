import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store resolves its path through `dataPath()`, so pointing the data dir at
// a throwaway folder keeps this away from any real document.
let root = "";
let previousDataDir: string | undefined;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "cc-store-"));
  previousDataDir = process.env.CAPITAL_COMMAND_DATA_DIR;
  process.env.CAPITAL_COMMAND_DATA_DIR = path.join(root, "data");
  vi.resetModules();
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.CAPITAL_COMMAND_DATA_DIR;
  else process.env.CAPITAL_COMMAND_DATA_DIR = previousDataDir;
  vi.restoreAllMocks();
});

const dataFile = () => path.join(root, "data", "capital-command.json");

describe("reading a data file that cannot be parsed", () => {
  it("refuses rather than replacing it with demo data", async () => {
    const { readAppData, AppDataUnreadableError } = await import("@/lib/storage/store");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path.dirname(dataFile()), { recursive: true });
    const broken = '{"contentItems": [ this is not json';
    writeFileSync(dataFile(), broken, "utf8");

    await expect(readAppData()).rejects.toBeInstanceOf(AppDataUnreadableError);
    // The document is exactly as it was — this is the whole point.
    expect(readFileSync(dataFile(), "utf8")).toBe(broken);
    // And a copy is kept to look at.
    expect(readdirSync(path.dirname(dataFile())).some((name) => name.includes("unreadable"))).toBe(true);
  });

  it("still seeds a file that genuinely does not exist", async () => {
    const { readAppData } = await import("@/lib/storage/store");
    const data = await readAppData();
    expect(Array.isArray(data.contentItems)).toBe(true);
    expect(readFileSync(dataFile(), "utf8").length).toBeGreaterThan(0);
  });
});

describe("how many copies a corrupt file gets", () => {
  it("keeps one, however many reads fail", async () => {
    const { readAppData } = await import("@/lib/storage/store");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path.dirname(dataFile()), { recursive: true });
    writeFileSync(dataFile(), "{not json", "utf8");

    // Every screen and the sidebar's 60s poll read app data; a copy per failed
    // read was thousands of copies of a multi-megabyte file in a day.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await readAppData().catch(() => undefined);
    }
    const copies = readdirSync(path.dirname(dataFile())).filter((name) => name.includes("unreadable"));
    expect(copies).toHaveLength(1);
  });

  it("gives a second, different corruption its own copy", async () => {
    const { readAppData } = await import("@/lib/storage/store");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path.dirname(dataFile()), { recursive: true });

    writeFileSync(dataFile(), "{not json", "utf8");
    await readAppData().catch(() => undefined);

    // A later, different corruption used to get nothing at all, because the
    // dedupe was "any copy in this folder" rather than "a copy of THIS file".
    writeFileSync(dataFile(), "{a completely different mess", "utf8");
    await readAppData().catch(() => undefined);

    const copies = readdirSync(path.dirname(dataFile())).filter((name) => name.includes("unreadable"));
    expect(copies).toHaveLength(2);
    const contents = copies.map((name) => readFileSync(path.join(path.dirname(dataFile()), name), "utf8"));
    expect(new Set(contents).size).toBe(2);
  });
});

const snapshotDir = () => path.join(root, "data", "snapshots");
const snapshots = () => readdirSync(snapshotDir()).filter((name) => name.endsWith(".json"));

// The snapshot deliberately does not hold up the save that triggered it, so a
// test that wants to see it has to wait for the copy carrying its own marker.
async function waitForSnapshotOf(marker: string) {
  const { latestGoodSnapshot } = await import("@/lib/storage/store");
  await vi.waitFor(async () => {
    const good = await latestGoodSnapshot();
    expect(good).not.toBeNull();
    expect(JSON.parse(readFileSync(good!.path, "utf8")).executionSeededAt).toBe(marker);
  });
}

describe("the last-known-good snapshot", () => {
  it("is written after a successful save", async () => {
    const { readAppData, writeAppData, latestGoodSnapshot } = await import("@/lib/storage/store");
    const data = await readAppData();
    await writeAppData({ ...data, executionSeededAt: "saved once", holdings: [] });
    await waitForSnapshotOf("saved once");

    const good = await latestGoodSnapshot();
    expect(JSON.parse(readFileSync(good!.path, "utf8")).holdings).toEqual([]);
  });

  it("puts a parseable document back when a restore is asked for", async () => {
    const { readAppData, writeAppData, restoreLastGoodSnapshot, AppDataUnreadableError } = await import(
      "@/lib/storage/store"
    );
    const data = await readAppData();
    await writeAppData({ ...data, executionSeededAt: "saved once", holdings: [] });
    await waitForSnapshotOf("saved once");

    writeFileSync(dataFile(), "{ruined", "utf8");
    await expect(readAppData()).rejects.toBeInstanceOf(AppDataUnreadableError);

    const restored = await restoreLastGoodSnapshot();
    expect(restored.snapshot.savedAt).toEqual(expect.any(String));
    // The document on disk is real data again, not the seed and not the mess.
    const onDisk = JSON.parse(readFileSync(dataFile(), "utf8"));
    expect(onDisk.holdings).toEqual([]);
    expect(Array.isArray(onDisk.contentItems)).toBe(true);
    await expect(readAppData()).resolves.toBeTruthy();
    // And the document it replaced was kept as evidence first.
    expect(readdirSync(path.dirname(dataFile())).filter((name) => name.includes("unreadable"))).toHaveLength(1);
  });

  it("refuses to offer a copy that does not parse", async () => {
    const { readAppData, writeAppData, latestGoodSnapshot } = await import("@/lib/storage/store");
    await writeAppData(await readAppData());
    await vi.waitFor(() => expect(snapshots().length).toBeGreaterThan(0));

    for (const name of snapshots()) writeFileSync(path.join(snapshotDir(), name), "{broken", "utf8");
    expect(await latestGoodSnapshot()).toBeNull();
  });
});
