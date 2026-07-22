import { describe, expect, it } from "vitest";
import {
  buildCalendarPlanPrompt,
  heuristicPlan,
  parseCalendarPlan,
  summarizeSchedule
} from "@/lib/master-calendar/planner";
import type { MasterCalendarEvent } from "@/lib/master-calendar/types";
import type { VideoIdea } from "@/types/domain";

function event(dateKey: string, source: MasterCalendarEvent["source"]): MasterCalendarEvent {
  return { id: `${source}:${dateKey}`, source, dateKey, title: "x", platforms: [], status: "scheduled" };
}

function idea(id: string, title: string, format: VideoIdea["format"] = "short"): VideoIdea {
  return {
    id,
    seedKeyword: "",
    title,
    angle: "",
    format,
    primaryKeyword: "",
    keywords: [],
    searchIntent: "tutorial",
    competition: "medium",
    score: 60,
    rationale: "",
    status: "suggested",
    source: "ai",
    createdAt: "2026-07-20T00:00:00.000Z"
  };
}

// Mon 2026-07-20 .. Sun 2026-07-26
const START = "2026-07-20";

describe("summarizeSchedule", () => {
  it("lists every day in the window, marking empty ones", () => {
    const summary = summarizeSchedule([event("2026-07-20", "shorts")], START, 3);
    const lines = summary.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("2026-07-20 (Mon): shorts");
    expect(lines[1]).toContain("nothing scheduled");
  });
});

describe("buildCalendarPlanPrompt", () => {
  it("includes the schedule, the cadence goal and the board ideas by id", () => {
    const prompt = buildCalendarPlanPrompt({
      events: [event("2026-07-20", "shorts")],
      ideas: [idea("idea-1", "Vibe Coding a SaaS")],
      startKey: START,
      days: 5
    });
    expect(prompt).toContain("Cadence goal");
    expect(prompt).toContain("[idea-1]");
    expect(prompt).toContain("Vibe Coding a SaaS");
    expect(prompt).toContain("2026-07-20");
  });
});

describe("parseCalendarPlan", () => {
  it("keeps in-window suggestions and validates idea ids", () => {
    const text =
      "[" +
      '{"dateKey":"2026-07-21","kind":"short","title":"New Short","reason":"gap","ideaId":"idea-1"},' +
      '{"dateKey":"2026-07-21","kind":"short","title":"Ghost idea","ideaId":"nope"},' +
      '{"dateKey":"2026-08-01","kind":"short","title":"Out of window"}' +
      "]";
    const out = parseCalendarPlan(text, { startKey: START, days: 7, ideaIds: new Set(["idea-1"]) });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ dateKey: "2026-07-21", weekday: "Tue", ideaId: "idea-1" });
    expect(out[1].ideaId).toBeUndefined(); // invalid id dropped, suggestion kept
  });

  it("returns [] when there is no JSON array", () => {
    expect(parseCalendarPlan("nope", { startKey: START, days: 7, ideaIds: new Set() })).toEqual([]);
  });
});

describe("heuristicPlan", () => {
  it("flags weekdays with no short and fills them from the board, skipping weekends", () => {
    // Only Monday has a short scheduled; Tue-Fri are gaps, Sat/Sun skipped.
    const plan = heuristicPlan({
      events: [event("2026-07-20", "shorts")],
      ideas: [idea("idea-1", "A"), idea("idea-2", "B")],
      startKey: START,
      days: 7
    });
    expect(plan.source).toBe("heuristic");
    const days = plan.suggestions.map((s) => s.dateKey);
    expect(days).toEqual(["2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24"]);
    // First two gaps draw from the board, in order.
    expect(plan.suggestions[0].ideaId).toBe("idea-1");
    expect(plan.suggestions[1].ideaId).toBe("idea-2");
  });
});
