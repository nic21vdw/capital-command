import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/publisher/vertical", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publisher/vertical")>();
  return {
    ...actual,
    prepareVerticalMedia: vi.fn(async (absolute: string) => ({ path: absolute, converted: false }))
  };
});

vi.setConfig({ testTimeout: 90_000 });

let dir: string;
let counter = 0;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "experiments-create-"));
  vi.stubEnv("PUBLISH_ENABLED", "true");
  vi.stubEnv("PUBLISH_PLATFORMS", "youtube,tiktok");
  vi.stubEnv("PUBLISH_TIMEZONE", "America/Toronto");
  vi.stubEnv("PUBLISH_SHORTS_PER_DAY", "2");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function clip(): Promise<string> {
  counter += 1;
  const file = path.join(dir, `clip-${counter}.mp4`);
  await writeFile(file, Buffer.alloc(64, counter));
  return file;
}

async function load() {
  return {
    create: await import("@/lib/experiments/create"),
    enqueue: (await import("@/lib/publisher/enqueue")).enqueue,
    duplicates: await import("@/lib/publisher/duplicates"),
    queue: (await import("@/lib/publisher/queue")).publishQueue,
    store: await import("@/lib/experiments/store"),
    spacing: await import("@/lib/experiments/spacing")
  };
}

const variants = [
  { value: "Agents Are Eating Software", origin: "original" as const },
  { value: "Why Every App Needs An Agent Now", origin: "ai" as const },
  { value: "I Let An Agent Run My Business", origin: "edited" as const }
];

describe("createExperiment against the real queue and its guards", () => {
  it("books every variant through enqueue, spaced 48 hours apart, and writes data/experiments.json", async () => {
    const { create, queue, store, spacing } = await load();
    const clipPath = await clip();
    const before = (await queue().list()).length;

    const { experiment, items } = await create.createExperiment({
      kind: "title",
      clipPath,
      jobId: "job-int-1",
      sourceLabel: "Integration clip",
      baseTitle: "Agents Are Eating Software",
      baseCaption: "Body.",
      hashtags: ["#AI"],
      variants,
      platforms: ["youtube", "tiktok"]
    });

    expect(items).toHaveLength(6);
    expect((await queue().list()).length).toBe(before + 6);
    const saved = await store.readExperiments();
    expect(saved.map((entry) => entry.id)).toContain(experiment.id);
    expect(JSON.parse(await readFile(store.experimentsFile(), "utf8")).experiments.length).toBeGreaterThan(0);

    const placements = experiment.variants.flatMap((variant) =>
      variant.placements.map((placement) => ({ variantId: variant.id, platform: placement.platform, accountId: placement.accountId, at: placement.publishAt }))
    );
    expect(spacing.spacingConflicts(placements)).toEqual([]);
    const days = new Set(items.map((item) => new Date(item.publishAt).toISOString().slice(0, 10)));
    expect(days.size).toBeGreaterThanOrEqual(3);
  });

  it("leaves the duplicate guard in force for everything else: the same file cannot be booked again, by a test or by hand", async () => {
    const { create, enqueue, duplicates, queue } = await load();
    const clipPath = await clip();
    await create.createExperiment({
      kind: "title",
      clipPath,
      jobId: "job-int-2",
      sourceLabel: "Integration clip",
      baseTitle: "Agents Are Eating Software",
      variants: variants.slice(0, 2),
      platforms: ["youtube"]
    });
    const count = (await queue().list()).length;

    await expect(
      create.createExperiment({
        kind: "title",
        clipPath,
        jobId: "job-int-2",
        sourceLabel: "Integration clip",
        baseTitle: "Agents Are Eating Software",
        variants: variants.slice(0, 2),
        platforms: ["tiktok"]
      })
    ).rejects.toThrow(create.ExperimentInputError);

    const slot = new Date(Date.now() + 40 * 86_400_000).toISOString();
    await expect(enqueue({ clipPath, publishAt: slot, title: "Another Title", caption: "c", hashtags: ["#ai"], platforms: ["youtube"] })).rejects.toThrow(
      duplicates.DuplicatePostError
    );
    expect((await queue().list()).length).toBe(count);
  });

  it("refuses to start from a clip that was already booked the ordinary way, and books nothing", async () => {
    const { create, enqueue, queue } = await load();
    const clipPath = await clip();
    await enqueue({ clipPath, publishAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), title: "Booked Already", caption: "c", hashtags: ["#ai"], platforms: ["youtube"] });
    const count = (await queue().list()).length;

    await expect(
      create.createExperiment({
        kind: "title",
        clipPath,
        jobId: "job-int-3",
        sourceLabel: "Integration clip",
        baseTitle: "Booked Already",
        variants: variants.slice(0, 2),
        platforms: ["youtube"]
      })
    ).rejects.toThrow(/already scheduled/);
    expect((await queue().list()).length).toBe(count);
  });
});
