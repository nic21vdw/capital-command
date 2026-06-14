import { describe, expect, it } from "vitest";
import { analyzeActivities, computeWeekStatus, weekStartKey } from "./analytics";
import type { XActivity } from "@/types/domain";

function activity(partial: Partial<XActivity>): XActivity {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    type: partial.type ?? "reply",
    date: partial.date ?? "2026-06-08",
    account: partial.account ?? "",
    topic: partial.topic ?? "topic",
    text: partial.text ?? "text",
    engagement: partial.engagement,
    createdAt: partial.createdAt ?? "2026-06-08T00:00:00.000Z"
  };
}

describe("weekStartKey", () => {
  // Weeks run Monday–Sunday. 2026-06-10 is a Wednesday → Monday is 2026-06-08.
  it("maps any day to the Monday of its week", () => {
    expect(weekStartKey("2026-06-10")).toBe("2026-06-08");
    expect(weekStartKey("2026-06-08")).toBe("2026-06-08"); // Monday maps to itself
    expect(weekStartKey("2026-06-14")).toBe("2026-06-08"); // Sunday still in same week
  });
});

describe("analyzeActivities", () => {
  const today = "2026-06-14";
  const analysis = analyzeActivities(
    [
      activity({ type: "reply", account: "@a", topic: "context", date: "2026-06-14" }),
      activity({ type: "reply", account: "@a", topic: "agents", date: "2026-06-12" }),
      activity({ type: "reply", account: "@a", topic: "review", date: "2026-06-05" }), // @a x3 in 30d → flag
      activity({ type: "reply", account: "@b", topic: "vertical", date: "2026-06-10" }),
      activity({ type: "post", topic: "harness", date: "2026-06-13" }),
      activity({ type: "reply", account: "@old", topic: "stale", date: "2026-05-01" }) // outside windows
    ],
    today
  );

  it("lists reply accounts from the last 7 days", () => {
    expect(analysis.accountsLast7Days).toEqual(["@a", "@b"]);
  });

  it("covers topics from replies and posts in the last 14 days only", () => {
    expect(analysis.topicsLast14Days).toContain("context");
    expect(analysis.topicsLast14Days).toContain("harness");
    expect(analysis.topicsLast14Days).not.toContain("stale");
  });

  it("counts this month's replies and posts", () => {
    expect(analysis.repliesThisMonth).toBe(4);
    expect(analysis.postsThisMonth).toBe(1);
  });

  it("flags accounts replied to more than twice in 30 days", () => {
    expect(analysis.frequentAccounts).toHaveLength(1);
    expect(analysis.frequentAccounts[0]).toMatchObject({ account: "@a", count: 3 });
  });
});

describe("computeWeekStatus catch-up math", () => {
  it("rolls a missed-day shortfall into today's goal", () => {
    // Week Mon 06-08..Sun 06-14, today = Wed 06-10, targets 3 replies + 1 post/day.
    // Mon: 0 replies, Tue: 1 reply. Expected before today = 2*3 = 6, done = 1 → deficit 5.
    const week = computeWeekStatus([activity({ type: "reply", account: "@x", date: "2026-06-09" })], 3, 1, "2026-06-10");
    expect(week.replyCarryDeficit).toBe(5);
    expect(week.todayReplyGoal).toBe(8);
    expect(week.remainingReplies).toBe(8);
    expect(week.postCarryDeficit).toBe(2); // 2 expected posts before today, 0 done
    expect(week.remainingPosts).toBe(3); // 1 base + 2 carry
    expect(week.days).toHaveLength(7);
    expect(week.days[0]?.date).toBe("2026-06-08");
    expect(week.days.find((d) => d.isToday)?.date).toBe("2026-06-10");
  });

  it("clears the deficit when prior days hit their minimums", () => {
    const activities: XActivity[] = [];
    for (const date of ["2026-06-08", "2026-06-09"]) {
      activities.push(
        activity({ type: "reply", date }),
        activity({ type: "reply", date }),
        activity({ type: "reply", date }),
        activity({ type: "post", date })
      );
    }
    const onPace = computeWeekStatus(activities, 3, 1, "2026-06-10");
    expect(onPace.replyCarryDeficit).toBe(0);
    expect(onPace.remainingReplies).toBe(3); // today's base only
    expect(onPace.remainingPosts).toBe(1);
  });
});
