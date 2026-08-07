import { describe, expect, it } from "vitest";
import { clipsNeedingCaption, planAutoAssign } from "@/components/uploading-center/bulk";
import type { ClipDraft, ReadyClip } from "@/components/uploading-center/use-uploading-center";
import type { ScheduleSlot } from "@/lib/publisher/slots";

const clip = (id: string): ReadyClip => ({
  key: `job1/${id}.mp4`,
  jobId: "job1",
  clipId: id,
  file: `${id}.mp4`,
  allFiles: [`${id}.mp4`],
  headline: id,
  durationSec: 30,
  thumbnailUrl: "",
  previewUrl: "",
  startSec: 0,
  needsRerender: false
});

const slot = (utc: string, past = false): ScheduleSlot => ({
  id: utc,
  dateKey: utc.slice(0, 10),
  dateLabel: utc.slice(0, 10),
  time: utc.slice(11, 16),
  utc,
  past,
  today: false
});

const draft = (over: Partial<ClipDraft> = {}): ClipDraft => ({
  title: "Title",
  caption: "",
  platform: "youtube",
  slotUtc: "",
  ...over
});

const clips = [clip("a"), clip("b"), clip("c")];
const never = () => false;

describe("clipsNeedingCaption", () => {
  it("returns the unscheduled, uncaptioned clips in the order they show on screen", () => {
    const result = clipsNeedingCaption({
      clips,
      draftFor: (candidate) => draft({ caption: candidate.clipId === "b" ? "already written" : "" }),
      isScheduled: (candidate) => candidate.clipId === "c"
    });
    expect(result.map((entry) => entry.clipId)).toEqual(["a"]);
  });

  it("treats a whitespace-only caption as missing", () => {
    const result = clipsNeedingCaption({
      clips: [clip("a")],
      draftFor: () => draft({ caption: "   \n " }),
      isScheduled: never
    });
    expect(result).toHaveLength(1);
  });
});

describe("planAutoAssign", () => {
  const slots = [
    slot("2026-08-05T11:30:00.000Z", true),
    slot("2026-08-06T11:30:00.000Z"),
    slot("2026-08-06T16:30:00.000Z"),
    slot("2026-08-06T23:30:00.000Z")
  ];

  it("gives each clip its own slot, soonest first, skipping past ones", () => {
    const { assignments, unslotted } = planAutoAssign({
      clips,
      draftFor: () => draft(),
      isScheduled: never,
      slots,
      isTargetSlotTaken: never
    });
    expect(unslotted).toBe(0);
    expect(assignments.map((entry) => entry.draft.slotUtc)).toEqual([
      "2026-08-06T11:30:00.000Z",
      "2026-08-06T16:30:00.000Z",
      "2026-08-06T23:30:00.000Z"
    ]);
  });

  it("carries the run's platform, hashtags and caption into the assignment", () => {
    const { assignments } = planAutoAssign({
      clips: [clip("a")],
      draftFor: () => draft({ title: "Clip #AI", caption: "written by AI", platform: "tiktok" }),
      isScheduled: never,
      slots,
      isTargetSlotTaken: never
    });
    expect(assignments[0].draft).toMatchObject({
      title: "Clip #AI",
      caption: "written by AI",
      platform: "tiktok"
    });
  });

  it("skips clips already on the queue", () => {
    const { assignments } = planAutoAssign({
      clips,
      draftFor: () => draft(),
      isScheduled: (candidate) => candidate.clipId === "a",
      slots,
      isTargetSlotTaken: never
    });
    expect(assignments.map((entry) => entry.clip.clipId)).toEqual(["b", "c"]);
  });

  it("never hands out a slot the board already booked", () => {
    const { assignments } = planAutoAssign({
      clips: [clip("a")],
      draftFor: () => draft(),
      isScheduled: never,
      slots,
      isTargetSlotTaken: (_target, slotUtc) => slotUtc === "2026-08-06T11:30:00.000Z"
    });
    expect(assignments[0].draft.slotUtc).toBe("2026-08-06T16:30:00.000Z");
  });

  it("counts the clips left over when the window runs out of slots", () => {
    const { assignments, unslotted } = planAutoAssign({
      clips,
      draftFor: () => draft(),
      isScheduled: never,
      slots: [slot("2026-08-06T11:30:00.000Z")],
      isTargetSlotTaken: never
    });
    expect(assignments).toHaveLength(1);
    expect(unslotted).toBe(2);
  });

  it("blocks a slot on every platform when a clip goes everywhere", () => {
    const { assignments } = planAutoAssign({
      clips: [clip("a"), clip("b")],
      draftFor: (candidate) => draft({ platform: candidate.clipId === "a" ? "all" : "tiktok" }),
      isScheduled: never,
      slots,
      isTargetSlotTaken: never
    });
    expect(assignments[0].draft.slotUtc).toBe("2026-08-06T11:30:00.000Z");
    expect(assignments[1].draft.slotUtc).toBe("2026-08-06T16:30:00.000Z");
  });
});
