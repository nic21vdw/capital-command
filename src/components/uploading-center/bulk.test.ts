import { describe, expect, it } from "vitest";
import {
  autoAssignableCount,
  bulkBookingLabel,
  clipsNeedingCaption,
  nameClips,
  planAutoAssign
} from "@/components/uploading-center/bulk";
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

const slot = (utc: string, past = false, today = false): ScheduleSlot => ({
  id: utc,
  dateKey: utc.slice(0, 10),
  dateLabel: utc.slice(0, 10),
  time: utc.slice(11, 16),
  utc,
  past,
  today,
  bookable: !past && !today
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

  // Auto-assign is what filled a day with a whole batch of shorts, so a slot
  // that is merely still-to-come today is not a target (schedule.ts).
  it("never puts a clip on a slot today, even one still to come", () => {
    const laterToday = slot("2026-08-06T23:30:00.000Z", false, true);
    const { assignments, unslotted } = planAutoAssign({
      clips: [clip("a")],
      draftFor: () => draft(),
      isScheduled: never,
      slots: [slot("2026-08-05T11:30:00.000Z", true), laterToday],
      isTargetSlotTaken: never
    });
    expect(assignments).toHaveLength(0);
    expect(unslotted).toBe(1);
  });

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

describe("planAutoAssign with failed captions", () => {
  const slots = [slot("2026-08-06T11:30:00.000Z"), slot("2026-08-06T16:30:00.000Z"), slot("2026-08-06T23:30:00.000Z")];

  // The whole point of the skip list: a clip with no AI caption must not be
  // scheduled with fallback copy behind a success message.
  it("holds back the clips whose caption failed and reports them", () => {
    const { assignments, heldBack } = planAutoAssign({
      clips,
      draftFor: () => draft(),
      isScheduled: never,
      slots,
      isTargetSlotTaken: never,
      skipKeys: new Set([clip("b").key])
    });
    expect(assignments.map((entry) => entry.clip.clipId)).toEqual(["a", "c"]);
    expect(heldBack.map((entry) => entry.clipId)).toEqual(["b"]);
  });

  // A held-back clip must not eat a slot on its way past, or every later clip
  // slides a slot down the calendar for nothing.
  it("leaves the held-back clip's slot for the clips behind it", () => {
    const { assignments } = planAutoAssign({
      clips,
      draftFor: () => draft(),
      isScheduled: never,
      slots,
      isTargetSlotTaken: never,
      skipKeys: new Set([clip("a").key])
    });
    expect(assignments.map((entry) => entry.draft.slotUtc)).toEqual([
      "2026-08-06T11:30:00.000Z",
      "2026-08-06T16:30:00.000Z"
    ]);
  });

  it("holds nothing back when nothing failed", () => {
    const { assignments, heldBack } = planAutoAssign({
      clips,
      draftFor: () => draft(),
      isScheduled: never,
      slots,
      isTargetSlotTaken: never
    });
    expect(heldBack).toEqual([]);
    expect(assignments).toHaveLength(3);
  });
});

describe("nameClips", () => {
  it("names one clip", () => {
    expect(nameClips(["Only one"])).toBe("“Only one”");
  });

  it("joins two and three with an and", () => {
    expect(nameClips(["A", "B"])).toBe("“A” and “B”");
    expect(nameClips(["A", "B", "C"])).toBe("“A”, “B” and “C”");
  });

  // A twelve-clip run must not produce a toast nobody reads.
  it("counts the rest past the limit", () => {
    expect(nameClips(["A", "B", "C", "D", "E"])).toBe("“A”, “B”, “C” and 2 more");
  });

  it("is empty when nothing failed", () => {
    expect(nameClips([])).toBe("");
  });
});

describe("the number the schedule-everything button promises", () => {
  const slots = [slot("2026-08-12T15:00:00.000Z"), slot("2026-08-13T15:00:00.000Z"), slot("2026-08-14T15:00:00.000Z")];
  const context = {
    clips,
    draftFor: () => draft(),
    isScheduled: never,
    slots,
    isTargetSlotTaken: never
  };

  it("counts what would be booked, not what is merely unscheduled", () => {
    // The button used to count every unscheduled clip, so it said "Schedule 3
    // clips" directly above a warning that one of them would be held back, and
    // then booked 2.
    expect(autoAssignableCount({ ...context, skipKeys: new Set([clip("b").key]) })).toBe(2);
  });

  it("agrees with the plan the press actually runs", () => {
    const skipKeys = new Set([clip("a").key]);
    expect(autoAssignableCount({ ...context, skipKeys })).toBe(
      planAutoAssign({ ...context, skipKeys }).assignments.length
    );
  });

  it("counts nothing when every slot is already taken", () => {
    expect(autoAssignableCount({ ...context, isTargetSlotTaken: () => true })).toBe(0);
  });

  it("counts everything when nothing is in the way", () => {
    expect(autoAssignableCount(context)).toBe(3);
  });
});

describe("planAutoAssign with the shorts-a-day cap", () => {
  const sevenClips = ["a", "b", "c", "d", "e", "f", "g"].map(clip);
  // Six open slots a day for three days, as the board draws them.
  const times = ["07:30", "10:00", "12:30", "15:00", "17:30", "20:00"];
  const slots = ["2026-08-06", "2026-08-07", "2026-08-08"].flatMap((day) =>
    times.map((time) => slot(`${day}T${time}:00.000Z`))
  );
  const perDay = (plan: ReturnType<typeof planAutoAssign>) => {
    const counts: Record<string, number> = {};
    for (const { draft: assigned } of plan.assignments) {
      counts[assigned.slotUtc.slice(0, 10)] = (counts[assigned.slotUtc.slice(0, 10)] ?? 0) + 1;
    }
    return counts;
  };

  it("never books more shorts on a day than the limit, and moves on to later days", () => {
    const plan = planAutoAssign({
      clips: sevenClips,
      draftFor: () => draft(),
      isScheduled: never,
      slots,
      isTargetSlotTaken: never,
      shortsCap: { limit: 2, booked: new Map() }
    });
    // Before the cap was planned for, all seven landed on the first day and the
    // server refused the third onward.
    expect(plan.assignments).toHaveLength(6);
    expect(perDay(plan)).toEqual({ "2026-08-06": 2, "2026-08-07": 2, "2026-08-08": 2 });
    expect(plan.unslotted).toBe(1);
    expect(plan.capBlocked).toBe(1);
  });

  it("counts shorts already booked on a day, so a second press does not stall on it", () => {
    const plan = planAutoAssign({
      clips: sevenClips.slice(0, 3),
      draftFor: () => draft(),
      isScheduled: never,
      slots,
      isTargetSlotTaken: never,
      shortsCap: { limit: 2, booked: new Map([["2026-08-06", 2], ["2026-08-07", 1]]) }
    });
    expect(perDay(plan)).toEqual({ "2026-08-07": 1, "2026-08-08": 2 });
    expect(plan.unslotted).toBe(0);
  });

  it("says the days are full, not that the slots ran out", () => {
    const plan = planAutoAssign({
      clips: sevenClips.slice(0, 2),
      draftFor: () => draft(),
      isScheduled: never,
      slots: slots.slice(0, 6),
      isTargetSlotTaken: never,
      shortsCap: { limit: 2, booked: new Map([["2026-08-06", 2]]) }
    });
    expect(plan.assignments).toHaveLength(0);
    expect(plan.capBlocked).toBe(2);
  });

  it("does not call it a full day when there were no free slots anyway", () => {
    const plan = planAutoAssign({
      clips: sevenClips.slice(0, 2),
      draftFor: () => draft(),
      isScheduled: never,
      slots: slots.slice(0, 6),
      isTargetSlotTaken: () => true,
      shortsCap: { limit: 2, booked: new Map() }
    });
    expect(plan.unslotted).toBe(2);
    expect(plan.capBlocked).toBe(0);
  });

  // One clip aimed at "All platforms" is a queue item per request (YouTube,
  // TikTok, and Instagram carrying Facebook), but the server counts distinct
  // videos, so it is still one short.
  it("charges a clip once however many platforms it posts to", () => {
    const plan = planAutoAssign({
      clips: [clip("a"), clip("b"), clip("c")],
      draftFor: (candidate) => draft({ platform: candidate.clipId === "c" ? "youtube" : "all" }),
      isScheduled: never,
      slots,
      isTargetSlotTaken: never,
      shortsCap: { limit: 2, booked: new Map() }
    });
    expect(plan.assignments).toHaveLength(3);
    expect(plan.unslotted).toBe(0);
    expect(perDay(plan)).toEqual({ "2026-08-06": 2, "2026-08-07": 1 });
  });

  it("fits two All-platforms clips on a day and moves the third to the next", () => {
    const plan = planAutoAssign({
      clips: [clip("a"), clip("b"), clip("c"), clip("d")],
      draftFor: () => draft({ platform: "all" }),
      isScheduled: never,
      slots,
      isTargetSlotTaken: never,
      shortsCap: { limit: 2, booked: new Map() }
    });
    expect(plan.capBlocked).toBe(0);
    expect(perDay(plan)).toEqual({ "2026-08-06": 2, "2026-08-07": 2 });
  });

  it("is unchanged when no cap is given", () => {
    const plan = planAutoAssign({
      clips: sevenClips,
      draftFor: () => draft(),
      isScheduled: never,
      slots,
      isTargetSlotTaken: never
    });
    expect(plan.assignments).toHaveLength(7);
    expect(plan.capBlocked).toBe(0);
  });
});

describe("bulkBookingLabel", () => {
  const times = ["07:30", "10:00", "12:30"];
  const slots = ["2026-08-06", "2026-08-07", "2026-08-08"].flatMap((day) =>
    times.map((time) => slot(`${day}T${time}:00.000Z`))
  );
  const plan = (count: number, limit?: number) =>
    planAutoAssign({
      clips: ["a", "b", "c", "d", "e", "f", "g"].slice(0, count).map(clip),
      draftFor: () => draft(),
      isScheduled: never,
      slots,
      isTargetSlotTaken: never,
      ...(limit ? { shortsCap: { limit, booked: new Map() } } : {})
    });

  it("states the daily pace and where it starts", () => {
    expect(bulkBookingLabel(plan(7, 2), slots, "2026-08-06")).toBe("Schedule 6 clips: 2 a day from tomorrow");
  });

  it("names the date when the first slot is not tomorrow", () => {
    expect(bulkBookingLabel(plan(4, 2), slots, "2026-08-05")).toBe("Schedule 4 clips: 2 a day from 2026-08-06");
  });

  it("does not talk about a pace for a single day", () => {
    expect(bulkBookingLabel(plan(2, 2), slots, "2026-08-06")).toBe("Schedule 2 clips for tomorrow");
    expect(bulkBookingLabel(plan(1, 2), slots, "2026-08-05")).toBe("Schedule 1 clip on 2026-08-06");
  });

  it("is null when nothing would be booked", () => {
    expect(bulkBookingLabel({ assignments: [] }, slots, "2026-08-06")).toBeNull();
  });
});
