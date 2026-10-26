import { describe, expect, it, vi } from "vitest";
import {
  BOOK_GROUP,
  BOOK_PLATFORMS,
  EMPTY_BOOK_DRAFT,
  applyBookField,
  bookControl,
  bookFields,
  bookingReading,
  clipChoices,
  startBooking,
  type BookDraft,
  type BookScheduler,
  type BookingContext,
  type BookingRecord,
  type ScheduleOutcome
} from "./book-clip";

const TZ = "America/Toronto";
const NOW = new Date("2026-10-14T15:00:00.000Z");

const CLIPS = [
  { key: "job1:a.mp4", headline: "Why the beam failed" },
  { key: "job1:b.mp4", headline: "Why the beam failed" },
  { key: "job1:c.mp4", headline: "Ten second rebar tip" }
];

const READY_DRAFT: BookDraft = {
  clipKey: "job1:c.mp4",
  platform: "youtube",
  at: "2026-10-16T18:00",
  caption: "Rebar in ten seconds"
};

function context(overrides: Partial<BookingContext<(typeof CLIPS)[number]>> = {}): BookingContext<(typeof CLIPS)[number]> {
  return { clips: CLIPS, timezone: TZ, now: NOW, publishingOn: true, loaded: true, busy: null, ...overrides };
}

type Scheduler = BookScheduler<(typeof CLIPS)[number]>;

function scheduler(outcome?: ScheduleOutcome, result = true) {
  return vi.fn(async (_clip, _override, hooks) => {
    if (outcome) hooks.onOutcome(outcome);
    return result;
  }) as unknown as Scheduler & ReturnType<typeof vi.fn>;
}

describe("clipChoices", () => {
  it("labels clips by headline and keeps two clips with one headline apart", () => {
    expect(clipChoices(CLIPS).map((choice) => choice.label)).toEqual(["Why the beam failed", "Why the beam failed (2)", "Ten second rebar tip"]);
  });

  it("names a clip with no headline rather than offering a blank", () => {
    expect(clipChoices([{ key: "k", headline: "  " }])[0].label).toBe("Untitled clip");
  });
});

describe("the Book clip fields", () => {
  it("offers clip, platform, time and caption, and never an all-platforms option", () => {
    const fields = bookFields(EMPTY_BOOK_DRAFT, CLIPS, TZ);
    expect(fields.map((field) => [field.id, field.kind])).toEqual([
      ["bookClip", "select"],
      ["bookPlatform", "select"],
      ["bookAt", "text"],
      ["bookCaption", "longtext"]
    ]);
    expect(fields[0].options).toEqual(["Why the beam failed", "Why the beam failed (2)", "Ten second rebar tip"]);
    expect(fields[1].options).toEqual(["youtube", "instagram", "tiktok", "facebook", "linkedin"]);
    expect(BOOK_PLATFORMS).not.toContain("all");
    expect(fields[2].hint).toContain(TZ);
  });

  it("shows what has been chosen, by the clip's label", () => {
    const fields = bookFields(READY_DRAFT, CLIPS, TZ);
    expect(fields.map((field) => field.value)).toEqual(["Ten second rebar tip", "youtube", "2026-10-16T18:00", "Rebar in ten seconds"]);
  });

  it("shows an empty clip when the chosen one has left the run", () => {
    expect(bookFields({ ...READY_DRAFT, clipKey: "gone" }, CLIPS, TZ)[0].value).toBe("");
  });
});

describe("writing the Book clip fields", () => {
  const apply = (id: string, value: string | number | boolean | null, draft = EMPTY_BOOK_DRAFT) =>
    applyBookField(draft, id, value, { clips: CLIPS, timezone: TZ });

  it("leaves every other field to the page", () => {
    expect(apply("runPlatform", "youtube")).toBeNull();
  });

  it("picks a clip by label, by key, or by the disambiguated label", () => {
    expect(apply("bookClip", "Ten second rebar tip")).toEqual({ draft: { ...EMPTY_BOOK_DRAFT, clipKey: "job1:c.mp4" } });
    expect(apply("bookClip", "job1:a.mp4")).toEqual({ draft: { ...EMPTY_BOOK_DRAFT, clipKey: "job1:a.mp4" } });
    expect(apply("bookClip", "Why the beam failed (2)")).toEqual({ draft: { ...EMPTY_BOOK_DRAFT, clipKey: "job1:b.mp4" } });
  });

  it("refuses a clip that is not in the run and lists the ones that are", () => {
    expect(apply("bookClip", "Nope")).toEqual({
      refused: expect.stringContaining('No clip called "Nope"')
    });
    expect(JSON.stringify(apply("bookClip", "Nope"))).toContain("Ten second rebar tip");
  });

  it("takes a platform in any case and refuses all and strangers", () => {
    expect(apply("bookPlatform", "TikTok")).toEqual({ draft: { ...EMPTY_BOOK_DRAFT, platform: "tiktok" } });
    expect(apply("bookPlatform", "all")).toEqual({ refused: expect.stringContaining("youtube, instagram, tiktok, facebook") });
    expect(apply("bookPlatform", "myspace")).toEqual({ refused: expect.stringContaining('"myspace"') });
    expect(apply("bookPlatform", 3)).toEqual({ refused: expect.any(String) });
  });

  it("takes a local time, an offset time and a clear, and refuses what the server could not read", () => {
    expect(apply("bookAt", "2026-10-16T18:00")).toEqual({ draft: { ...EMPTY_BOOK_DRAFT, at: "2026-10-16T18:00" } });
    expect(apply("bookAt", "2026-10-16T22:00:00Z")).toEqual({ draft: { ...EMPTY_BOOK_DRAFT, at: "2026-10-16T22:00:00Z" } });
    expect(apply("bookAt", "", READY_DRAFT)).toEqual({ draft: { ...READY_DRAFT, at: "" } });
    expect(apply("bookAt", "next tuesday")).toEqual({ refused: expect.stringContaining("Could not parse publish time") });
    expect(apply("bookAt", 5)).toEqual({ refused: expect.any(String) });
  });

  it("takes a caption and clears it on null", () => {
    expect(apply("bookCaption", "Hello")).toEqual({ draft: { ...EMPTY_BOOK_DRAFT, caption: "Hello" } });
    expect(apply("bookCaption", null, READY_DRAFT)).toEqual({ draft: { ...READY_DRAFT, caption: "" } });
    expect(apply("bookCaption", 5)).toEqual({ refused: expect.any(String) });
  });
});

describe("the Book control", () => {
  it("is marked destructive, because it schedules a real post", () => {
    const control = bookControl(context());
    expect(control).toMatchObject({ id: "book", label: "Book", group: BOOK_GROUP, destructive: true, disabled: false });
  });

  it.each([
    ["posting is off", { publishingOn: false }, "Posting is off"],
    ["the schedule has not loaded", { loaded: false }, "still loading"],
    ["there are no clips", { clips: [] }, "no finished clips"],
    ["something else is being booked", { busy: "schedule:job1:a.mp4" }, "in progress"]
  ])("is disabled, and says why, when %s", (_, overrides, hint) => {
    const control = bookControl(context(overrides));
    expect(control.disabled).toBe(true);
    expect(control.hint).toContain(hint);
  });
});

describe("pressing Book", () => {
  it("names an explicit LinkedIn booking and uses the existing scheduling path", async () => {
    const schedule = scheduler({ ok: true, message: "Scheduled." });
    const records: BookingRecord[] = [];
    const started = startBooking({ ...READY_DRAFT, platform: "linkedin" }, context(), schedule, (record) => records.push(record));
    expect(started.ok).toBe(true);
    if (started.ok) await started.done;
    expect(schedule.mock.calls[0][1].platform).toBe("linkedin");
    expect(records[0].text).toContain("LinkedIn");
    expect(records[0].text).not.toContain("undefined");
  });
  it("books through the one booking path, with the chosen clip, platform, instant and caption", async () => {
    const schedule = scheduler({ ok: true, message: "Scheduled." });
    const records: BookingRecord[] = [];
    const started = startBooking(READY_DRAFT, context(), schedule, (record) => records.push(record));
    expect(started.ok).toBe(true);
    if (started.ok) await started.done;
    expect(schedule).toHaveBeenCalledTimes(1);
    const [clip, override] = schedule.mock.calls[0];
    expect(clip).toBe(CLIPS[2]);
    expect(override).toEqual({ platform: "youtube", slotUtc: "2026-10-16T22:00:00.000Z", caption: "Rebar in ten seconds" });
    expect(records.map((record) => record.phase)).toEqual(["booking", "booked"]);
  });

  it("reads a time with an explicit offset as that instant", async () => {
    const schedule = scheduler({ ok: true, message: "ok" });
    const started = startBooking({ ...READY_DRAFT, at: "2026-10-17T03:30:00+09:00" }, context(), schedule, () => undefined);
    if (started.ok) await started.done;
    expect(schedule.mock.calls[0][1].slotUtc).toBe("2026-10-16T18:30:00.000Z");
  });

  it("leaves the caption alone when none was given, so the clip's own draft stands", async () => {
    const schedule = scheduler({ ok: true, message: "ok" });
    const started = startBooking({ ...READY_DRAFT, caption: "   " }, context(), schedule, () => undefined);
    if (started.ok) await started.done;
    expect(schedule.mock.calls[0][1]).toEqual({ platform: "youtube", slotUtc: "2026-10-16T22:00:00.000Z" });
  });

  it.each([
    ["posting is off", READY_DRAFT, { publishingOn: false }, "Posting is off"],
    ["the schedule has not loaded", READY_DRAFT, { loaded: false }, "still loading"],
    ["another booking is running", READY_DRAFT, { busy: "schedule:x" }, "in progress"],
    ["no clip is chosen", { ...READY_DRAFT, clipKey: "" }, {}, 'Clip to book'],
    ["the chosen clip has left the run", { ...READY_DRAFT, clipKey: "gone" }, {}, "no longer"],
    ["no platform is chosen", { ...READY_DRAFT, platform: "" as const }, {}, "Platform to book on"],
    ["no time is set", { ...READY_DRAFT, at: "" }, {}, "Post at"],
    ["the time cannot be read", { ...READY_DRAFT, at: "soonish" }, {}, "Could not parse publish time"],
    ["the time has passed", { ...READY_DRAFT, at: "2026-10-13T18:00" }, {}, "already passed"]
  ])("refuses, without booking anything, when %s", (_, draft, overrides, reason) => {
    const schedule = scheduler({ ok: true, message: "ok" });
    const started = startBooking(draft, context(overrides), schedule, () => undefined);
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.reason).toContain(reason);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("reports the duplicate guard's refusal word for word", async () => {
    const message = "This clip is already scheduled on YouTube at Oct 16, 6:00 PM.";
    const schedule = scheduler({ ok: false, message }, false);
    const records: BookingRecord[] = [];
    const started = startBooking(READY_DRAFT, context(), schedule, (record) => records.push(record));
    if (started.ok) expect(await started.done).toBe(false);
    expect(records.at(-1)).toEqual({ phase: "refused", text: expect.stringContaining(message) });
  });

  it("reports a daily-cap refusal the same way", async () => {
    const message = "That day already holds 4 shorts, the limit.";
    const schedule = scheduler({ ok: false, message }, false);
    const records: BookingRecord[] = [];
    const started = startBooking(READY_DRAFT, context(), schedule, (record) => records.push(record));
    if (started.ok) await started.done;
    expect(records.at(-1)?.phase).toBe("refused");
    expect(records.at(-1)?.text).toContain(message);
  });

  it("passes along whatever the booking path says when it accepts, including a hold", async () => {
    const message = "Held for approval before it posts.";
    const schedule = scheduler({ ok: true, message });
    const records: BookingRecord[] = [];
    const started = startBooking(READY_DRAFT, context(), schedule, (record) => records.push(record));
    if (started.ok) await started.done;
    expect(records.at(-1)).toEqual({ phase: "booked", text: expect.stringContaining(message) });
  });

  it("says it was refused when the path returns false without a reason", async () => {
    const schedule = scheduler(undefined, false);
    const records: BookingRecord[] = [];
    const started = startBooking(READY_DRAFT, context(), schedule, (record) => records.push(record));
    if (started.ok) await started.done;
    expect(records.at(-1)?.phase).toBe("refused");
  });

  it("reports a thrown error as a refusal instead of leaving the booking hanging", async () => {
    const schedule = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as Scheduler;
    const records: BookingRecord[] = [];
    const started = startBooking(READY_DRAFT, context(), schedule, (record) => records.push(record));
    if (started.ok) expect(await started.done).toBe(false);
    expect(records.at(-1)).toEqual({ phase: "refused", text: expect.stringContaining("network down") });
  });
});

describe("the Last booking reading", () => {
  it("reads idle until something has been booked", () => {
    expect(bookingReading({ phase: "idle", text: "" })).toEqual({ label: "Last booking", value: "None yet this session." });
  });

  it("carries the phase and the text", () => {
    expect(bookingReading({ phase: "refused", text: "x" })).toEqual({ label: "Last booking", value: "Refused: x" });
    expect(bookingReading({ phase: "booked", text: "y" })).toEqual({ label: "Last booking", value: "Booked: y" });
    expect(bookingReading({ phase: "booking", text: "z" })).toEqual({ label: "Last booking", value: "In progress: z" });
  });
});
