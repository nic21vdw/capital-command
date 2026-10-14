import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { experimentsFile, normalizeExperiments, readExperiments, updateExperiments } from "@/lib/experiments/store";
import { experiment, variant } from "@/lib/experiments/test-helpers";

const writes = vi.hoisted(() => ({ files: [] as string[] }));

vi.mock("@/lib/storage/atomic-json", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/storage/atomic-json")>();
  return {
    ...original,
    atomicWriteJson: vi.fn(async (file: string, value: unknown, options?: Parameters<typeof original.atomicWriteJson>[2]) => {
      writes.files.push(file);
      return original.atomicWriteJson(file, value, options);
    })
  };
});

const sample = () => experiment([variant("A", [{ itemId: "a1", publishAt: "2026-10-10T15:00:00.000Z" }]), variant("B", [{ itemId: "b1", publishAt: "2026-10-13T15:00:00.000Z" }])]);

describe("the experiments store", () => {
  it("lives in data/experiments.json", () => {
    expect(experimentsFile()).toBe(dataPath("experiments.json"));
    expect(path.basename(experimentsFile())).toBe("experiments.json");
  });

  it("reads as empty, and creates nothing, when there is no file", async () => {
    expect(await readExperiments()).toEqual([]);
    await expect(readFile(experimentsFile(), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes through the shared atomic writer and leaves no temporary file behind", async () => {
    writes.files.length = 0;
    await updateExperiments((file) => {
      file.experiments.push(sample());
    });
    expect(writes.files).toContain(experimentsFile());
    expect(JSON.parse(await readFile(experimentsFile(), "utf8"))).toMatchObject({ version: 1, experiments: [{ id: "exp1" }] });
    expect((await readdir(path.dirname(experimentsFile()))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect((await readExperiments()).map((entry) => entry.id)).toEqual(["exp1"]);
  });

  it("serialises overlapping updates so none is lost", async () => {
    await Promise.all(
      [1, 2, 3, 4, 5].map((number) =>
        updateExperiments((file) => {
          file.experiments.push({ ...sample(), id: `many-${number}` });
        })
      )
    );
    const ids = (await readExperiments()).map((entry) => entry.id);
    for (const number of [1, 2, 3, 4, 5]) expect(ids).toContain(`many-${number}`);
  });

  it("refuses to overwrite a file it cannot read", async () => {
    await mkdir(path.dirname(experimentsFile()), { recursive: true });
    await writeFile(experimentsFile(), "{ not json", "utf8");
    await expect(updateExperiments((file) => file.experiments.push(sample()))).rejects.toThrow(/experiments\.json could not be read/);
    expect(await readFile(experimentsFile(), "utf8")).toBe("{ not json");
    await writeFile(experimentsFile(), JSON.stringify({ version: 1, experiments: [] }), "utf8");
  });
});

describe("normalizeExperiments", () => {
  it("keeps a well-formed experiment as it is", () => {
    expect(normalizeExperiments({ version: 1, experiments: [sample()] }).experiments).toEqual([sample()]);
  });

  it("drops entries that are not experiments and variants that are not variants", () => {
    const broken = { ...sample(), id: "broken", variants: [{ id: "A" }] };
    const result = normalizeExperiments({
      version: 1,
      experiments: [null, 7, { id: "x" }, broken, { ...sample(), kind: "colour" }, sample()]
    });
    expect(result.experiments.map((entry) => entry.id)).toEqual(["exp1"]);
  });

  it("falls back to an empty file for anything else", () => {
    expect(normalizeExperiments(null)).toEqual({ version: 1, experiments: [] });
    expect(normalizeExperiments([])).toEqual({ version: 1, experiments: [] });
  });
});
