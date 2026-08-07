import { describe, expect, it } from "vitest";
import { planAdhocPosts } from "@/lib/threads/adhoc";
import { autopilotItemsForDate, isAutopilotItem, itemsForDate } from "@/lib/threads/queue";
import type { ThreadsConfig } from "@/lib/threads/config";
import type { ThreadsQueueItem } from "@/lib/threads/types";

const config = {
  enabled: true,
  timezone: "America/Toronto",
  postsPerDay: 6,
  accounts: [
    { id: "main", posts: "text", offsetMinutes: 0 },
    { id: "second", posts: "threadsVariant", offsetMinutes: 30 }
  ]
} as unknown as ThreadsConfig;

const now = new Date("2026-08-06T14:00:00.000Z");

let counter = 0;
const newId = () => `id-${(counter += 1)}`;

describe("posts scheduled from a stream", () => {
  it("posts from one account only — two accounts saying the same words is mirrored spam", () => {
    counter = 0;
    const items = planAdhocPosts({ texts: ["one", "two"], config, now, taken: new Set(), newId });
    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => item.accountId))).toEqual(new Set(["main"]));
  });

  it("spaces them out and never lands on an instant already taken", () => {
    counter = 0;
    const first = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const items = planAdhocPosts({ texts: ["one", "two"], config, now, taken: new Set([first]), newId });
    expect(items[0].publishAt).not.toBe(first);
    expect(new Date(items[1].publishAt).getTime()).toBeGreaterThan(new Date(items[0].publishAt).getTime());
  });

  it("schedules them in the future, never in the past", () => {
    counter = 0;
    const items = planAdhocPosts({ texts: ["one"], config, now, taken: new Set(), newId });
    expect(new Date(items[0].publishAt).getTime()).toBeGreaterThan(now.getTime());
  });

  it("is invisible to the autopilot's 'is this day planned?' check", () => {
    counter = 0;
    const items = planAdhocPosts({ texts: ["one"], config, now, taken: new Set(), runId: "run1", newId });
    const date = items[0].batchDate;
    expect(items[0].origin).toBe("pipeline");
    expect(items[0].sourceRunId).toBe("run1");
    expect(isAutopilotItem(items[0])).toBe(false);
    // The day still reads as unplanned, so the daily pack still gets written…
    expect(autopilotItemsForDate(items, date)).toEqual([]);
    // …while every surface that lists the day still shows the post.
    expect(itemsForDate(items, date)).toHaveLength(1);
  });

  it("counts an older item with no origin as the autopilot's", () => {
    const legacy = { id: "old", batchDate: "2026-08-06" } as ThreadsQueueItem;
    expect(isAutopilotItem(legacy)).toBe(true);
  });

  it("never uses one of the day's numbered slots", () => {
    counter = 0;
    const items = planAdhocPosts({ texts: ["one"], config, now, taken: new Set(), newId });
    expect(items[0].slot).toBe(0);
  });
});
