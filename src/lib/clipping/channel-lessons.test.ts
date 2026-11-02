import { describe, expect, it } from "vitest";
import { BASELINE_LESSONS, rankTitleLessons, titleLessonsBlock } from "./channel-lessons";
import type { PostRow } from "@/lib/analytics/query";

const now = new Date("2026-11-01T12:00:00Z");

function row(title: string, views: number, daysAgo: number, extra: Partial<PostRow> = {}): PostRow {
  return {
    platform: "youtube",
    format: "video",
    status: "ok",
    title,
    publishedAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
    metrics: { views },
    ...extra
  } as PostRow;
}

describe("rankTitleLessons", () => {
  it("keeps the baseline until enough Shorts are measured", () => {
    expect(rankTitleLessons([row("A", 10, 5)], now)).toBe(BASELINE_LESSONS);
  });

  it("takes the channel's own best and worst recent YouTube Shorts", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(`Short ${i} #shorts`, i * 100, 10));
    rows.push(row("Too new", 99_999, 1), row("Too old", 99_999, 400), row("Long", 99_999, 10, { format: "long-form" }));
    rows.push(row("Instagram", 99_999, 10, { platform: "instagram" }));
    const lessons = rankTitleLessons(rows, now);
    expect(lessons.source).toBe("analytics");
    expect(lessons.worked[0]).toEqual({ title: "Short 19", views: 1900 });
    expect(lessons.flopped[0]).toEqual({ title: "Short 0", views: 0 });
    expect(lessons.worked.map((l) => l.title)).not.toContain("Too new");
  });
});

describe("titleLessonsBlock", () => {
  it("names both the winners and the flops with their views", () => {
    const block = titleLessonsBlock(BASELINE_LESSONS);
    expect(block).toContain("Spend $20 on ChatGPT to Vibe Code an App (1,115 views)");
    expect(block).toContain("Passion for AI Tech Drives This Project (9 views)");
  });
});
