import { describe, expect, it } from "vitest";
import { threadsSlotStatus } from "@/lib/master-calendar/aggregate";
import { autopilotHeader, formatThreadsStamp, packSplitNote, postState, summarizeThreadsToday, todayHeadline } from "@/lib/threads/todaySummary";
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

const TORONTO = { timeZone: "America/Toronto" };

describe("today's Threads numbers", () => {
  it("counts a post once however many accounts send it, and includes hand-added posts", () => {
    const summary = summarizeThreadsToday(fixtureDay(), "2026-10-10");
    // 6 pack slots on two accounts (12 rows) + 1 hand-added post (1 row) = 7 posts, however many rows send them.
    expect(summary).toMatchObject({ posts: 7, sent: 3, waiting: 4, failed: 0, skipped: 0 });
    expect(summary).not.toHaveProperty("sends");
  });

  it("splits the day into the pack's posts and the ones added outside it", () => {
    const summary = summarizeThreadsToday(fixtureDay(), "2026-10-10");
    expect(summary).toMatchObject({ posts: 7, fromPack: 6, added: 1 });
    expect(packSplitNote(summary)).toBe("6 from today's pack + 1 added by hand or from a stream = 7 posts today.");
    // Nothing added: the pack and the day agree, so there is nothing to explain.
    expect(packSplitNote(summarizeThreadsToday(fixtureDay().filter((item) => item.id !== "adhoc"), "2026-10-10"))).toBeNull();
  });

  it("makes the next post the earliest pending row by its own time, on any day, with its account", () => {
    const rows = fixtureDay();
    expect(summarizeThreadsToday(rows, "2026-10-10").next).toEqual({ at: "2026-10-11T00:00:00.000Z", topic: "Topic", accountId: "primary" });
    expect(summarizeThreadsToday(rows, "2026-10-12").next?.at).toBe("2026-10-11T00:00:00.000Z");
    expect(summarizeThreadsToday(rows.map((item) => ({ ...item, status: "published" as const })), "2026-10-10").next).toBeNull();
  });

  it("shows ONE number and ONE next step in the headline", () => {
    // The next row is 8:00 PM on Oct 10 in Toronto - the day being summarised - so no date is printed.
    const summary = summarizeThreadsToday(fixtureDay(), "2026-10-10");
    expect(todayHeadline(summary, TORONTO)).toBe("7 posts today - next at 8:00 PM");
    expect(todayHeadline(summary, { ...TORONTO, accountLabel: (id) => (id === "primary" ? "Account 1" : "Account 2") })).toBe("7 posts today - next at 8:00 PM on Account 1");
    // The headline is the same posts count the summary carries: never a second number from another source.
    expect(todayHeadline(summary, TORONTO).match(/\b\d+\s+posts?\b/g)).toEqual(["7 posts"]);
  });

  it("names the day when the next post is not on the day being summarised", () => {
    const summary = summarizeThreadsToday(fixtureDay(), "2026-10-11");
    expect(todayHeadline(summary, TORONTO)).toBe("1 post today - next at Oct 10, 8:00 PM");
  });

  it("says what is left instead of a next time when nothing is pending", () => {
    const sent = summarizeThreadsToday([row({ id: "a", status: "published" }), row({ id: "b", slot: 2, status: "published" })], "2026-10-10");
    expect(todayHeadline(sent, TORONTO)).toBe("2 posts today - all sent");
    const failed = summarizeThreadsToday([row({ id: "a", status: "published" }), row({ id: "b", slot: 2, status: "failed" })], "2026-10-10");
    expect(todayHeadline(failed, TORONTO)).toBe("2 posts today - 1 failed, retry below");
  });

  it("reads an empty day plainly", () => {
    expect(todayHeadline(summarizeThreadsToday([], "2026-10-10"), TORONTO)).toBe("Nothing queued for today yet");
    expect(todayHeadline(summarizeThreadsToday([row({ id: "a", batchDate: "2026-10-11", publishAt: "2026-10-12T00:00:00.000Z" })], "2026-10-10"), TORONTO)).toBe(
      "Nothing queued for today yet - next at Oct 11, 8:00 PM"
    );
    expect(todayHeadline(summarizeThreadsToday([row({ id: "a", status: "published" })], "2026-10-10"), TORONTO)).toBe("1 post today - all sent");
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
  it("describes the cadence and the pack without counting today's posts", () => {
    const text = autopilotHeader({ ...base, pack: { label: "Today's pack" } });
    expect(text).toContain("Today's pack is written");
    expect(text).toContain("post on each of your accounts, each post followed by a link reply");
    expect(text).toContain("sends them for you");
    // Today's count lives in the card's headline only: no number may appear here to disagree with it.
    expect(text).not.toMatch(/\d/);
  });
  it("claims nothing about the cadence before the status has loaded", () => {
    expect(autopilotHeader({ ...base, known: false, pack: { label: "Today's pack" } })).toBe("Today's pack is written - copy anything from it to post by hand.");
  });
  it("does not say it is set to post when no account is connected", () => {
    const text = autopilotHeader({ ...base, accounts: 0, armed: false, pack: null });
    expect(text).toContain("Once a Threads account is connected it will post up to 24 times a day.");
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
