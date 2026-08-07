import { describe, expect, it } from "vitest";
import { assignSlots, type QueueCandidate } from "@/lib/pipeline/queueOutputs";

const candidate = (kind: QueueCandidate["kind"], title: string): QueueCandidate => ({
  id: `${kind}:${title}`,
  kind,
  title,
  filePath: `C:/outputs/${title}.mp4`,
  platforms: kind === "clip" ? [] : ["youtube"]
});

const slots = ["2026-08-07T11:30:00.000Z", "2026-08-07T16:30:00.000Z", "2026-08-07T23:30:00.000Z"];

describe("booking a run's outputs", () => {
  it("leads with the long-form edit, then its segments, then the shorts", () => {
    const booked = assignSlots(
      [candidate("clip", "short one"), candidate("segment", "part two"), candidate("longform", "the stream")],
      slots
    );
    expect(booked.map((entry) => entry.candidate.title)).toEqual(["the stream", "part two", "short one"]);
  });

  it("never books two outputs into the same slot", () => {
    const booked = assignSlots(
      [candidate("clip", "a"), candidate("clip", "b"), candidate("clip", "c")],
      slots
    );
    expect(new Set(booked.map((entry) => entry.publishAt)).size).toBe(3);
  });

  it("leaves the overflow without a slot rather than stacking it on the last one", () => {
    const booked = assignSlots([candidate("clip", "a"), candidate("clip", "b")], [slots[0]]);
    expect(booked[0].publishAt).toBe(slots[0]);
    expect(booked[1].publishAt).toBeUndefined();
  });
});
