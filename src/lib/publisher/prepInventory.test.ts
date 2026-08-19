import { describe, expect, it } from "vitest";
import { buildPrepInventory, queuedMediaPaths } from "@/lib/publisher/prepInventory";
import type { LongformProject } from "@/lib/longform/types";
import type { QueueItem } from "@/lib/publisher/types";
import type { Carousel } from "@/types/domain";

function queueItem(extra: Partial<QueueItem>): QueueItem {
  return {
    id: "q1",
    clipPath: "",
    title: "",
    caption: "",
    hashtags: [],
    publishAt: "2026-08-19T11:30:00.000Z",
    visibility: "public",
    createdAt: "2026-08-01T00:00:00.000Z",
    platforms: {},
    ...extra
  };
}

function project(id: string, extra: Partial<LongformProject> = {}): LongformProject {
  return {
    id,
    name: `Edit ${id}`,
    status: "ready",
    exports: [{ id: "e1", status: "done", progress: 100, createdAt: "2026-08-01T00:00:00.000Z" }],
    ...extra
  } as LongformProject;
}

function carousel(id: string, title = `Deck ${id}`): Carousel {
  return { id, title, sourceType: "custom", slides: [], createdAt: "2026-08-01T00:00:00.000Z" };
}

describe("queuedMediaPaths", () => {
  it("normalizes Windows separators and case so path matching works either way", () => {
    const paths = queuedMediaPaths([
      queueItem({ clipPath: "data\\Longform\\Outputs\\AE78\\edited.mp4" }),
      queueItem({ clipPath: "first.jpg", imagePaths: ["data/carousels/carousel-9/slide-1.jpg"] })
    ]);
    expect(paths).toContain("data/longform/outputs/ae78/edited.mp4");
    expect(paths).toContain("data/carousels/carousel-9/slide-1.jpg");
  });
});

describe("buildPrepInventory", () => {
  it("counts a finished long-form edit as unscheduled until the queue references its folder", () => {
    const inventory = buildPrepInventory({
      queue: [queueItem({ clipPath: "data\\longform\\outputs\\aaa\\edited-1.mp4" })],
      projects: [project("aaa"), project("bbb")],
      renderedCarousels: []
    });

    expect(inventory.longform).toMatchObject({ ready: 2, scheduled: 1 });
    expect(inventory.longform.unscheduled).toEqual([{ id: "bbb", title: "Edit bbb" }]);
  });

  it("ignores projects that are not ready or have no finished export", () => {
    const inventory = buildPrepInventory({
      queue: [],
      projects: [
        project("ready-done"),
        project("still-working", { status: "processing" } as Partial<LongformProject>),
        project("no-export", { exports: [] })
      ],
      renderedCarousels: []
    });

    expect(inventory.longform.ready).toBe(1);
    expect(inventory.longform.unscheduled.map((p) => p.id)).toEqual(["ready-done"]);
  });

  it("matches a carousel by any slide the queue already books", () => {
    const inventory = buildPrepInventory({
      queue: [
        queueItem({
          clipPath: "data/carousels/deck-1/slide-1.jpg",
          imagePaths: ["data/carousels/deck-1/slide-1.jpg", "data/carousels/deck-1/slide-2.jpg"]
        })
      ],
      projects: [],
      renderedCarousels: [carousel("deck-1"), carousel("deck-2")]
    });

    expect(inventory.carousels).toMatchObject({ rendered: 2, scheduled: 1 });
    expect(inventory.carousels.unscheduled).toEqual([{ id: "deck-2", title: "Deck deck-2" }]);
  });

  it("does not let one id match another that merely starts the same", () => {
    const inventory = buildPrepInventory({
      queue: [queueItem({ imagePaths: ["data/carousels/deck-10/slide-1.jpg"] })],
      projects: [],
      renderedCarousels: [carousel("deck-1"), carousel("deck-10")]
    });

    expect(inventory.carousels.unscheduled.map((c) => c.id)).toEqual(["deck-1"]);
  });
});
