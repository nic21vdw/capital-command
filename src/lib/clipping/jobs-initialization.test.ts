import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";

const file = dataPath("clips", "jobs.json");
const first = { id: "one", fileName: "First", status: "done", clips: [], createdAt: "2026-11-17T12:00:00Z" };
const second = { ...first, id: "two", fileName: "Second" };

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("__clipJobs", undefined);
  vi.stubGlobal("__clipJobsReady", undefined);
  await mkdir(path.dirname(file), { recursive: true });
});

afterEach(() => vi.unstubAllGlobals());

describe("clip job initialization", () => {
  it("waits for the existing jobs before servicing simultaneous reads and edits", async () => {
    await writeFile(file, JSON.stringify([first, second]));
    const { getJob, renameJob } = await import("./jobs");
    const [original, renamed] = await Promise.all([
      getJob("one"),
      renameJob("two", { fileName: "Renamed" })
    ]);

    expect(original).toEqual(first);
    expect(renamed?.fileName).toBe("Renamed");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual([first, { ...second, fileName: "Renamed" }]);
  });

  it.each(["{", JSON.stringify([first, null])])("preserves an unreadable store and retries after repair", async (broken) => {
    await writeFile(file, broken);
    const { deleteJob, getJob, listJobs } = await import("./jobs");
    const results = await Promise.allSettled([listJobs(), deleteJob("two")]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(await readFile(file, "utf8")).toBe(broken);

    await writeFile(file, JSON.stringify([second]));
    expect(await getJob("two")).toEqual(second);
    expect(await getJob("one")).toBeUndefined();
  });
});
