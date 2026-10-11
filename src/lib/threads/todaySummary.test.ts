import { describe, expect, it } from "vitest";
import { threadsSlotStatus } from "@/lib/master-calendar/aggregate";
import { autopilotHeader, formatThreadsStamp, postState, summarizeThreadsToday, todayHeadline, todaySendsNote } from "@/lib/threads/todaySummary";
import type { ThreadsQueueItem } from "@/lib/threads/types";

type Row = Parameters<typeof summarizeThreadsToday>[0] extends (infer R)[] | undefined ? R : never;

function row(over: Partial<Row> & { id: string }): Row {
  return { batchDate: "2026-10-10", slot: 1, accountId: "primary", status: "pending", publishAt: "2026-10-11T12:00:00.000Z", origin: undefined, topic: "Topic", ...over } as Row;
}

/** The fixture's day: three slots out on two accounts, three waiting, one hand-added post waiting. */
function fixtureDay(): Row[] {
  const rows: Row[] = [];
  for (const slot of [1, 2, 3]) for (const accountId of ["primary", "secondary"]) rows.push(row({ id: `p${slot}${accountId}`, slot, accountId, status: "published", publishAt: `2026-10-10T1${slot}:00:00.000Z` }));
  for (const slot of [4, 5, 6]) for (const accountId of ["primary", "secondary"]) rows.push(row({ id: `p${slot}${accountId}`, slot, accountId, publishAt: `2026-10-11T0${slot - 4}:00:00.000Z` }));
  rows.push(row({ id: "adhoc", slot: 0, origin: "pipeline", publishAt: "2026-10-11T02:54:55.908Z" }));
  rows.push(row({ id: "tomorrow", batchDate: "2026-10-11", slot: 1, publishAt: "2026-10-11T12:10:00.000Z" }));
  return rows;
}

describe("today's Threads numbers", () => {
  it("counts a post once however many accounts send it, and includes hand-added posts", () => {
    const summary = summarizeThreadsToday(fixtureDay(), "2026-10-10");
    expect(summary).toMatchObject({ posts: 7, sent: 3, waiting: 4, failed: 0, skipped: 0, sends: 13, sendsDone: 6, accounts: 2 });
    expect(todayHeadline(summary)).toBe("3 of 7 posts sent today");
    expect(todaySendsNote(summary)).toContain("6 of 13 sends across 2 accounts");
  });

  it("makes the next post the earliest pending row by its own time, on any day", () => {
    const rows = fixtureDay();
    expect(summarizeThreadsToday(rows, "2026-10-10").next).toEqual({ at: "2026-10-11T00:00:00.000Z", topic: "Topic" });
    expect(summarizeThreadsToday(rows, "2026-10-12").next?.at).toBe("2026-10-11T00:00:00.000Z");
    expect(summarizeThreadsToday(rows.map((item) => ({ ...item, status: "published" as const })), "2026-10-10").next).toBeNull();
  });

  it("says nothing extra for one account, and reads an empty day plainly", () => {
    const single = summarizeThreadsToday([row({ id: "a", status: "published" }), row({ id: "b", slot: 2 })], "2026-10-10");
    expect(todaySendsNote(single)).toBe("");
    expect(todayHeadline(single)).toBe("1 of 2 posts sent today");
    expect(todayHeadline(summarizeThreadsToday([], "2026-10-10"))).toBe("Nothing queued for today yet");
    expect(todayHeadline(summarizeThreadsToday([row({ id: "a", status: "published" })], "2026-10-10"))).toBe("1 of 1 post sent today");
  });

  it("rolls a post's accounts up exactly like the Day Summary does", () => {
    const statuses: ThreadsQueueItem["status"][] = ["published", "pending", "failed", "skipped"];
    const combos: ThreadsQueueItem["status"][][] = [];
    for (const a of statuses) { combos.push([a]); for (const b of statuses) combos.push([a, b]); }
    const calendarToState = (status: string) => (status === "published" ? "sent" : status === "queued" ? "waiting" : status === "skipped" ? "skipped" : "failed");
    for (const combo of combos) expect(postState(combo), combo.join("+")).toBe(calendarToState(threadsSlotStatus(combo.map((status) => ({ status })))));
  });

  it("formats the next post in the autopilot's time zone", () => {
    expect(formatThreadsStamp("2026-10-11T00:00:00.000Z", "America/Toronto")).toMatch(/Oct 10.*8:00\s?PM/);
    expect(formatThreadsStamp(null, "America/Toronto")).toBe("Not yet");
  });
});

describe("the page header", () => {
  const base = { postsPerDay: 24, accounts: 2, linkReplies: true, paused: false, armed: true, known: true };
  it("describes the configured cadence and the pack actually written", () => {
    const text = autopilotHeader({ ...base, pack: { posts: 6, replies: 2, label: "Today's pack" } });
    expect(text).toContain("Today's pack has 6 posts and 2 replies to use by hand");
    expect(text).toContain("24 times a day on each of 2 accounts, each followed by a link reply");
    expect(text).not.toMatch(/\b20 replies\b/);
    expect(text).toContain("sends them for you");
  });
  it("claims nothing about the cadence before the status has loaded", () => {
    expect(autopilotHeader({ ...base, known: false, pack: { posts: 6, replies: 2, label: "Today's pack" } })).toBe("Today's pack has 6 posts and 2 replies to use by hand.");
  });
  it("does not say it is set to post when no account is connected", () => {
    const text = autopilotHeader({ ...base, accounts: 0, armed: false, pack: null });
    expect(text).toContain("Once a Threads account is connected it will post 24 times a day.");
    expect(text).not.toContain("sends them");
  });
  it("mentions link replies only when they are on, and says when it is paused or has no pack", () => {
    const text = autopilotHeader({ ...base, accounts: 1, linkReplies: false, paused: true, armed: false, pack: null });
    expect(text).not.toContain("link reply");
    expect(text).not.toContain("accounts");
    expect(text).toContain("No pack is written yet");
    expect(text).toContain("paused on Automations");
  });
});
