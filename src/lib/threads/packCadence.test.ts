import { describe, expect, it } from "vitest";
import { cadenceBadge, gapText, isEarlierPack, orderPackPosts, packOrderNote, packSizeNote, packTimeRange, windowClock } from "@/lib/threads/packCadence";
import { zonedDateKey } from "@/lib/threads/zone";

describe("cadenceBadge", () => {
  const whole = { start: 20, end: 1400 };
  it("derives the gap and the window from the configuration", () => {
    expect(cadenceBadge({ postsPerDay: 24, window: whole })).toBe("up to 24 a day, about every 60 min at that rate, 12:20 AM to 11:20 PM");
  });
  it("says per account with several accounts", () => {
    expect(cadenceBadge({ postsPerDay: 24, accounts: 2, window: whole })).toContain("up to 24 a day per account");
  });
  it("reads a pulled-back window and a wider gap in hours", () => {
    expect(cadenceBadge({ postsPerDay: 4, window: { start: 540, end: 1260 } })).toBe("up to 4 a day, about every 4 h at that rate, 9:00 AM to 9:00 PM");
  });
  it("drops what it cannot derive instead of guessing", () => {
    expect(cadenceBadge({ postsPerDay: null })).toBeNull();
    expect(cadenceBadge({ postsPerDay: 0 })).toBeNull();
    expect(cadenceBadge({ postsPerDay: 24 })).toBe("up to 24 a day");
    expect(cadenceBadge({ postsPerDay: 1, window: whole })).toBe("1 a day, 12:20 AM to 11:20 PM");
    expect(cadenceBadge({ postsPerDay: 24, window: { start: 600, end: 600 } })).toBe("up to 24 a day");
  });
  it("never says the old hard-coded 40 minutes", () => {
    expect(cadenceBadge({ postsPerDay: 24, window: whole })).not.toContain("40");
  });
});

describe("packSizeNote", () => {
  it("names both numbers when the pack is not the configured day", () => {
    expect(packSizeNote({ packPosts: 6, postsPerDay: 24, label: "Today" })).toBe("Today: 6 ideas in the pack; the autopilot posts up to 24 a day.");
    expect(packSizeNote({ packPosts: 1, postsPerDay: 24, label: "Today" })).toContain("1 idea in the pack");
  });
  it("is silent when they agree or the cadence is unknown", () => {
    expect(packSizeNote({ packPosts: 24, postsPerDay: 24, label: "Today" })).toBeNull();
    expect(packSizeNote({ packPosts: 6, postsPerDay: undefined, label: "Today" })).toBeNull();
  });
});

describe("isEarlierPack", () => {
  it("is false for today's pack however old it is, true only for a past date", () => {
    expect(isEarlierPack("2026-10-11", "2026-10-11")).toBe(false);
    expect(isEarlierPack("2026-10-10", "2026-10-11")).toBe(true);
    expect(isEarlierPack("2026-10-12", "2026-10-11")).toBe(false);
  });
  it("claims nothing when a date is unknown or malformed", () => {
    expect(isEarlierPack("2026-10-10", null)).toBe(false);
    expect(isEarlierPack("yesterday", "2026-10-11")).toBe(false);
  });
  it("reads today in the Threads zone: 8 PM Toronto is still the same day though UTC has moved on", () => {
    const evening = new Date("2026-10-12T00:30:00Z"); // 8:30 PM on Oct 11 in Toronto
    const today = zonedDateKey("America/Toronto", evening);
    expect(today).toBe("2026-10-11");
    expect(isEarlierPack("2026-10-11", today)).toBe(false);
    expect(isEarlierPack("2026-10-11", zonedDateKey("UTC", evening))).toBe(true);
  });
});

describe("clock words", () => {
  it("formats minutes", () => {
    expect(windowClock(20)).toBe("12:20 AM");
    expect(windowClock(1400)).toBe("11:20 PM");
    expect(windowClock(1440)).toBe("midnight");
    expect(gapText(54.6)).toBe("55 min");
    expect(gapText(150)).toBe("2 h 30 min");
  });
});

describe("packTimeRange", () => {
  it("reads the pack's own span earliest to latest", () => {
    expect(packTimeRange([{ time: "08:10" }, { time: "13:25" }, { time: "21:20" }])).toBe("8:10 AM to 9:20 PM");
  });

  it("sorts by the clock instead of printing first-to-last as a backwards range", () => {
    const wrapped = ["09:05", "12:20", "15:40", "23:10", "00:45", "02:20"].map((time) => ({ time }));
    expect(packTimeRange(wrapped)).toBe("12:45 AM to 11:10 PM");
  });

  it("handles a single post, an empty pack and junk times", () => {
    expect(packTimeRange([{ time: "08:10" }])).toBe("8:10 AM");
    expect(packTimeRange([])).toBeNull();
    expect(packTimeRange([{ time: "soon" }, { time: "25:00" }])).toBeNull();
  });
});

describe("orderPackPosts", () => {
  const wrapped = [
    ["a", 1, "09:05"],
    ["b", 2, "12:20"],
    ["c", 3, "15:40"],
    ["d", 4, "23:45"],
    ["e", 5, "01:20"],
    ["f", 6, "02:55"]
  ].map(([id, slot, time]) => ({ id: id as string, slot: slot as number, time: time as string }));

  it("lists a pack by the clock and names the posts the slot order had put after midnight", () => {
    const { ordered, early, reordered } = orderPackPosts(wrapped);
    expect(ordered.map((post) => post.id)).toEqual(["e", "f", "a", "b", "c", "d"]);
    expect([...early]).toEqual(["e", "f"]);
    expect(reordered).toBe(true);
  });

  it("leaves a pack that already runs in clock order alone", () => {
    const tidy = wrapped.filter((post) => post.time >= "09:00");
    const { ordered, early, reordered } = orderPackPosts(tidy);
    expect(ordered.map((post) => post.id)).toEqual(["a", "b", "c", "d"]);
    expect(early.size).toBe(0);
    expect(reordered).toBe(false);
  });

  it("keeps a time that is not a time at the end instead of guessing", () => {
    const { ordered } = orderPackPosts([
      { id: "x", slot: 1, time: "soon" },
      { id: "y", slot: 2, time: "08:00" }
    ]);
    expect(ordered.map((post) => post.id)).toEqual(["y", "x"]);
  });

  it("breaks a tie on the slot", () => {
    const { ordered } = orderPackPosts([
      { id: "two", slot: 2, time: "10:00" },
      { id: "one", slot: 1, time: "10:00" }
    ]);
    expect(ordered.map((post) => post.id)).toEqual(["one", "two"]);
  });
});

describe("packOrderNote", () => {
  it("says the early posts are that same morning, not after midnight", () => {
    const posts = [
      { id: "a", time: "09:05" },
      { id: "e", time: "01:20" },
      { id: "f", time: "02:55" }
    ];
    const note = packOrderNote({ posts, early: new Set(["e", "f"]), dayLabel: "Saturday, Oct 10", zoneName: "Toronto" });
    expect(note).toContain("2 posts are timed for 1:20 AM, 2:55 AM");
    expect(note).toContain("early morning of Saturday, Oct 10 itself in Toronto time, not after midnight");
    expect(note).toContain("clock order");
  });

  it("reads right for a single post and an unknown zone", () => {
    const note = packOrderNote({ posts: [{ id: "e", time: "01:20" }], early: new Set(["e"]), dayLabel: "Saturday, Oct 10" });
    expect(note).toContain("One post is timed for 1:20 AM");
    expect(note).toContain("it sits before");
    expect(note).not.toContain(" time,");
  });
});
