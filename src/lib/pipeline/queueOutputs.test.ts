import { describe, expect, it } from "vitest";
import { assignSlots, carouselCandidate, type QueueCandidate } from "@/lib/pipeline/queueOutputs";
import { MAX_IMAGES_PER_POST } from "@/lib/publisher/images";
import type { Carousel } from "@/types/domain";

const candidate = (kind: QueueCandidate["kind"], title: string): QueueCandidate => ({
  id: `${kind}:${title}`,
  kind,
  title,
  filePath: `C:/outputs/${title}.mp4`,
  platforms: kind === "clip" ? [] : ["youtube"]
});

const slots = ["2026-08-07T11:30:00.000Z", "2026-08-07T16:30:00.000Z", "2026-08-07T23:30:00.000Z"];

describe("booking a run's outputs", () => {
  const outputs = () => [
    candidate("clip", "short one"),
    candidate("segment", "part two"),
    candidate("longform", "the stream")
  ];

  it("books every output exactly once", () => {
    const booked = assignSlots(outputs(), slots, 7);
    expect(booked.map((entry) => entry.candidate.title).sort()).toEqual(["part two", "short one", "the stream"]);
  });

  it("puts a different output first depending on the seed", () => {
    const first = new Set(
      Array.from({ length: 50 }, (_, seed) => assignSlots(outputs(), slots, seed + 1)[0].candidate.title)
    );
    expect(first.size).toBe(3);
  });

  it("deals the same order twice for one seed", () => {
    const order = () => assignSlots(outputs(), slots, 12).map((entry) => entry.candidate.title);
    expect(order()).toEqual(order());
  });

  it("never books two outputs into the same slot", () => {
    const booked = assignSlots(
      [candidate("clip", "a"), candidate("clip", "b"), candidate("clip", "c")],
      slots,
      7
    );
    expect(new Set(booked.map((entry) => entry.publishAt)).size).toBe(3);
  });

  it("leaves the overflow without a slot rather than stacking it on the last one", () => {
    const booked = assignSlots([candidate("clip", "a"), candidate("clip", "b")], [slots[0]]);
    expect(booked[0].publishAt).toBe(slots[0]);
    expect(booked[1].publishAt).toBeUndefined();
  });
});

const carousel = (slides: number): Pick<Carousel, "id" | "title" | "slides"> => ({
  id: "deck-1",
  title: "What one stream produces",
  slides: Array.from({ length: slides }, (_, index) => ({ id: `s${index}`, heading: `H${index}`, body: "" }))
});

const files = (count: number) =>
  Array.from({ length: count }, (_, index) => `C:/data/carousels/deck-1/slide-0${index + 1}.png`);

describe("booking a run's carousel", () => {
  it("offers the whole deck as one picture post, in slide order", () => {
    const { candidate } = carouselCandidate({ carousel: carousel(3), files: files(3), alreadyQueued: new Set() });
    expect(candidate?.id).toBe("carousel:deck-1");
    expect(candidate?.imagePaths).toEqual(files(3));
    // The first slide is also the path the queue dedupes on.
    expect(candidate?.filePath).toBe(files(3)[0]);
    expect(candidate?.platforms).toEqual([]);
  });

  it("does not offer a deck that is already booked", () => {
    const result = carouselCandidate({
      carousel: carousel(3),
      files: files(3),
      alreadyQueued: new Set([files(3)[0].toLowerCase()])
    });
    expect(result.candidate).toBeUndefined();
    expect(result.skipped?.reason).toBe("Already scheduled.");
  });

  it("says so rather than booking a deck past the picture-post ceiling", () => {
    const tooLong = MAX_IMAGES_PER_POST + 1;
    const result = carouselCandidate({ carousel: carousel(tooLong), files: files(tooLong), alreadyQueued: new Set() });
    expect(result.candidate).toBeUndefined();
    expect(result.skipped?.reason).toContain(String(tooLong));
  });

  it("says so when nothing has been rendered yet", () => {
    const result = carouselCandidate({ carousel: carousel(3), files: [], alreadyQueued: new Set() });
    expect(result.skipped?.reason).toBe("No rendered slides yet.");
  });

  it("has nothing to say about an empty deck", () => {
    expect(carouselCandidate({ carousel: carousel(0), files: [], alreadyQueued: new Set() })).toEqual({});
  });

  it("gives the deck its own slot among the videos it came from", () => {
    const deck = () => [
      { id: "carousel:deck-1", kind: "carousel" as const, title: "deck", filePath: "a.png", platforms: [] },
      candidate("clip", "short one"),
      candidate("longform", "the stream")
    ];
    const booked = assignSlots(deck(), slots, 7);
    expect(new Set(booked.map((entry) => entry.publishAt)).size).toBe(3);
    expect(booked.map((entry) => entry.candidate.kind).sort()).toEqual(["carousel", "clip", "longform"]);
    const positions = new Set(
      Array.from({ length: 50 }, (_, seed) =>
        assignSlots(deck(), slots, seed + 1).findIndex((entry) => entry.candidate.kind === "carousel")
      )
    );
    expect(positions.size).toBe(3);
  });
});
