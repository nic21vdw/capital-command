import { describe, expect, it, vi } from "vitest";
import { ExperimentInputError, createExperiment, type CreateDeps, type CreateExperimentInput } from "@/lib/experiments/create";
import { assertVariantSpacing, type Placement } from "@/lib/experiments/spacing";
import { queueItem } from "@/lib/experiments/test-helpers";
import type { Experiment } from "@/lib/experiments/types";
import type { EnqueueOptions } from "@/lib/publisher/enqueue";
import type { QueueItem } from "@/lib/publisher/types";

const NOW = new Date("2026-10-13T16:00:00.000Z");
const CLIP = "data/clips/outputs/job1/clip.mp4";

function harness(overrides: { queue?: QueueItem[]; failOn?: number } = {}) {
  const queue: QueueItem[] = overrides.queue ?? [];
  const booked: EnqueueOptions[] = [];
  const removed: string[] = [];
  const saved: Experiment[] = [];
  const deps: CreateDeps = {
    now: () => NOW,
    newId: () => "exp-test",
    config: { timezone: "America/Toronto", slotTimes: ["07:30", "12:30", "18:00"], weekendSlotTimes: ["10:00", "16:00"], shortsPerDay: 2 },
    listQueue: async () => queue,
    book: async (options) => {
      if (overrides.failOn !== undefined && booked.length === overrides.failOn) throw new Error("YouTube refused the upload.");
      booked.push(options);
      const platform = options.platforms![0];
      const item = queueItem(`item-${booked.length}`, new Date(options.publishAt as string).toISOString(), { [platform]: "pending" }, {
        title: options.title ?? "",
        clipPath: CLIP,
        jobId: options.jobId,
        ...(options.accountId ? { accountId: options.accountId } : {})
      });
      queue.push(item);
      return item;
    },
    unbook: async (id) => {
      removed.push(id);
    },
    save: async (experiment) => {
      saved.push(experiment);
    }
  };
  return { deps, queue, booked, removed, saved };
}

function input(overrides: Partial<CreateExperimentInput> = {}): CreateExperimentInput {
  return {
    kind: "title",
    clipPath: CLIP,
    jobId: "job1",
    clipId: "clip1",
    file: "clip.mp4",
    sourceLabel: "Clip about agents",
    baseTitle: "Agents Are Eating Software",
    baseCaption: "The caption body.",
    hashtags: ["#AI"],
    variants: [
      { value: "Agents Are Eating Software", origin: "original" },
      { value: "Why Every App Needs An Agent Now", origin: "ai" },
      { value: "I Let An Agent Run My Business", origin: "edited" }
    ],
    platforms: ["youtube", "instagram"],
    ...overrides
  };
}

describe("createExperiment", () => {
  it("books each variant as its own post on every chosen platform, with the variant's title", async () => {
    const { deps, booked } = harness();
    await createExperiment(input(), deps);
    expect(booked).toHaveLength(6);
    expect(booked.map((entry) => entry.title)).toEqual([
      "Agents Are Eating Software",
      "Agents Are Eating Software",
      "Why Every App Needs An Agent Now",
      "Why Every App Needs An Agent Now",
      "I Let An Agent Run My Business",
      "I Let An Agent Run My Business"
    ]);
    expect(booked.map((entry) => entry.platforms)).toEqual([["youtube"], ["instagram"], ["youtube"], ["instagram"], ["youtube"], ["instagram"]]);
    expect(booked.every((entry) => entry.clipPath === CLIP && entry.jobId === "job1" && entry.visibility === "public" && entry.format === "short")).toBe(true);
    expect(booked.every((entry) => entry.by === "experiment-book")).toBe(true);
  });

  it("puts a variant's platforms at one moment and never two variants on one platform within 48 hours", async () => {
    const { deps, booked, saved } = harness();
    await createExperiment(input(), deps);
    const times = booked.map((entry) => new Date(entry.publishAt as string).getTime());
    expect(times[0]).toBe(times[1]);
    expect(times[2]).toBe(times[3]);
    expect(times[4]).toBe(times[5]);
    const placements: Placement[] = saved[0].variants.flatMap((variant) =>
      variant.placements.map((placement) => ({ variantId: variant.id, platform: placement.platform, accountId: placement.accountId, at: placement.publishAt }))
    );
    expect(() => assertVariantSpacing(placements)).not.toThrow();
    expect(times[2] - times[0]).toBeGreaterThanOrEqual(48 * 3_600_000);
    expect(times[4] - times[2]).toBeGreaterThanOrEqual(48 * 3_600_000);
  });

  it("starts tomorrow at the earliest", async () => {
    const { deps, booked } = harness();
    await createExperiment(input(), deps);
    expect(new Date(booked[0].publishAt as string).toISOString()).toBe("2026-10-14T11:30:00.000Z");
  });

  it("lets only the experiment's own extra bookings past the duplicate guard, and the first booking meets it unaided", async () => {
    const { deps, booked } = harness();
    await createExperiment(input(), deps);
    expect(booked[0].allowDuplicate).toBeFalsy();
    expect(booked.slice(1).every((entry) => entry.allowDuplicate === true)).toBe(true);
  });

  it("records the experiment with its variants, where each one is booked and when", async () => {
    const { deps, saved } = harness();
    const { experiment } = await createExperiment(input(), deps);
    expect(saved).toEqual([experiment]);
    expect(experiment).toMatchObject({
      id: "exp-test",
      kind: "title",
      windowHours: 72,
      createdAt: NOW.toISOString(),
      source: { label: "Clip about agents", jobId: "job1", clipId: "clip1", file: "clip.mp4" }
    });
    expect(experiment.variants.map((variant) => [variant.id, variant.origin, variant.placements.map((placement) => placement.platform)])).toEqual([
      ["A", "original", ["youtube", "instagram"]],
      ["B", "ai", ["youtube", "instagram"]],
      ["C", "edited", ["youtube", "instagram"]]
    ]);
    expect(experiment.variants[0].placements.map((placement) => placement.itemId)).toEqual(["item-1", "item-2"]);
    expect(experiment.decision).toBeUndefined();
  });

  it("tests a hook by changing the caption's opening line and keeping the title", async () => {
    const { deps, booked } = harness();
    await createExperiment(
      input({
        kind: "hook",
        platforms: ["instagram"],
        variants: [
          { value: "Nobody tells you this about agents.", origin: "original" },
          { value: "I was wrong about agents.", origin: "edited" }
        ]
      }),
      deps
    );
    expect(booked.map((entry) => entry.title)).toEqual(["Agents Are Eating Software", "Agents Are Eating Software"]);
    expect(booked[0].caption).toBe("Nobody tells you this about agents.\n\nThe caption body.");
    expect(booked[1].caption).toBe("I was wrong about agents.\n\nThe caption body.");
  });

  it("gives every variant the same caption and hashtags, so only the tested thing differs", async () => {
    const { deps, booked } = harness();
    await createExperiment(input({ baseCaption: undefined, hashtags: undefined, baseTitle: "Agents Are Eating Software #AI" }), deps);
    expect(new Set(booked.map((entry) => entry.caption))).toEqual(new Set(["Agents Are Eating Software"]));
    expect(new Set(booked.map((entry) => JSON.stringify(entry.hashtags))).size).toBe(1);
    expect(booked[0].hashtags).toContain("#shorts");
  });

  it("refuses a hook test that includes YouTube, which will not take one title twice", async () => {
    const { deps, booked } = harness();
    await expect(
      createExperiment(input({ kind: "hook", platforms: ["youtube", "instagram"], variants: [{ value: "One.", origin: "original" }, { value: "Two.", origin: "edited" }] }), deps)
    ).rejects.toThrow(/YouTube.*title/);
    expect(booked).toEqual([]);
  });

  it("refuses a clip that is already on the schedule, so the duplicate guard still means what it says", async () => {
    const { deps, booked, saved } = harness({ queue: [queueItem("existing", "2026-10-20T15:00:00.000Z", { youtube: "pending" })] });
    await expect(createExperiment(input(), deps)).rejects.toThrow(ExperimentInputError);
    await expect(createExperiment(input(), deps)).rejects.toThrow(/already scheduled/);
    expect(booked).toEqual([]);
    expect(saved).toEqual([]);
  });

  it("does not count a failed earlier booking as a duplicate", async () => {
    const { deps, booked } = harness({ queue: [queueItem("old", "2026-10-01T15:00:00.000Z", { youtube: "failed" })] });
    await createExperiment(input({ platforms: ["youtube"] }), deps);
    expect(booked).toHaveLength(3);
  });

  it("skips slots that are taken on a chosen platform", async () => {
    const taken = queueItem("other", "2026-10-14T11:30:00.000Z", { instagram: "pending" }, { clipPath: "data/clips/outputs/other/other.mp4", jobId: "other" });
    const { deps, booked } = harness({ queue: [taken] });
    await createExperiment(input(), deps);
    expect(new Date(booked[0].publishAt as string).toISOString()).not.toBe("2026-10-14T11:30:00.000Z");
  });

  it("takes back what it booked and records nothing when a later booking fails", async () => {
    const { deps, booked, removed, saved } = harness({ failOn: 2 });
    await expect(createExperiment(input(), deps)).rejects.toThrow(/YouTube refused/);
    expect(booked).toHaveLength(2);
    expect(removed).toEqual(["item-1", "item-2"]);
    expect(saved).toEqual([]);
  });

  it("refuses a thumbnail test, because a queued post has nowhere to carry a thumbnail", async () => {
    const { deps, booked } = harness();
    await expect(createExperiment(input({ kind: "thumbnail" }), deps)).rejects.toThrow(/thumbnail/i);
    expect(booked).toEqual([]);
  });

  it.each([
    ["one variant", [{ value: "Only one", origin: "edited" as const }], /2 or 3/],
    [
      "four variants",
      ["a", "b", "c", "d"].map((value) => ({ value: `Title ${value}`, origin: "edited" as const })),
      /2 or 3/
    ],
    ["a blank variant", [{ value: "Fine title", origin: "edited" as const }, { value: "   ", origin: "edited" as const }], /blank/],
    ["two variants that read the same", [{ value: "Same Title", origin: "edited" as const }, { value: "same title!", origin: "ai" as const }], /same/]
  ])("refuses %s", async (_name, variants, message) => {
    const { deps, booked } = harness();
    await expect(createExperiment(input({ variants }), deps)).rejects.toThrow(message);
    expect(booked).toEqual([]);
  });

  it("refuses when no platform is chosen", async () => {
    const { deps } = harness();
    await expect(createExperiment(input({ platforms: [] }), deps)).rejects.toThrow(/platform/);
  });

  it("books on the account it was told to use, and spaces accounts independently", async () => {
    const { deps, booked } = harness();
    await createExperiment(input({ platforms: ["youtube"], accountIds: { youtube: "youtube-second" } }), deps);
    expect(booked.every((entry) => entry.accountId === "youtube-second")).toBe(true);
  });

  it("says so when the schedule has no room for the variants", async () => {
    const full = vi.fn(async () => {
      throw new Error("not reached");
    });
    const { deps } = harness();
    deps.config = { ...deps.config, slotTimes: [], weekendSlotTimes: [] };
    deps.book = full;
    await expect(createExperiment(input(), deps)).rejects.toThrow(/no room/i);
    expect(full).not.toHaveBeenCalled();
  });
});
