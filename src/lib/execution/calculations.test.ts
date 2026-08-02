import { describe, expect, it } from "vitest";
import {
  computeWeekBreakdown,
  openDebtFor,
  perfectDayStreak
} from "@/lib/execution/calculations";
import { reconcileExecution } from "@/lib/execution/reconcile";
import { addDays, toLocalDateString, weekStart } from "@/lib/execution/dates";
import type { ExecutionCompletion, ExecutionGoal } from "@/types/domain";

const NOW = "2026-06-15T12:00:00.000Z";
// 2026-06-15 is a Monday, so it starts a fresh current week; every week before
// it (Jun 8–14, Jun 1–7, ...) has fully ended and is eligible for reconciliation.
const TODAY = "2026-06-15";

// Every `createdAt` below is midday UTC, not midnight. A goal's creation week
// comes from its timestamp read as a LOCAL date (goalCreatedDate), so a
// midnight-UTC fixture lands on the previous day west of Greenwich and drags
// the goal back into the week before — which showed up as one extra missed
// week of debt in every assertion here.

function makeGoal(overrides: Partial<ExecutionGoal> = {}): ExecutionGoal {
  return {
    id: overrides.id ?? "g-stream",
    title: overrides.title ?? "Livestreams",
    description: overrides.description,
    category: overrides.category ?? "YouTube",
    frequency: overrides.frequency ?? "weekly",
    dailyTarget: overrides.dailyTarget ?? 0,
    weeklyTarget: overrides.weeklyTarget ?? 5,
    icon: overrides.icon ?? "Radio",
    displayOrder: overrides.displayOrder ?? 0,
    active: overrides.active ?? true,
    createdAt: overrides.createdAt ?? "2026-05-01T12:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-01T12:00:00.000Z",
    archivedAt: overrides.archivedAt
  };
}

let seq = 0;
function mkCompletion(goalId: string, date: string, quantity = 1): ExecutionCompletion {
  seq += 1;
  return {
    id: `c-${seq}`,
    goalId,
    date,
    timestamp: `${date}T10:00:00.000Z`,
    quantity,
    source: "manual",
    createdAt: `${date}T10:00:00.000Z`
  };
}

/** Spread N completions across distinct days within the week starting `ws`. */
function completionsForWeek(goalId: string, ws: string, count: number): ExecutionCompletion[] {
  const out: ExecutionCompletion[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(mkCompletion(goalId, addDays(ws, i % 7)));
  }
  return out;
}

describe("computeWeekBreakdown", () => {
  it("separates baseline, debt repayment, and overachievement", () => {
    // Baseline 5, starting debt 2, completed 8 → 5 baseline, 2 debt, 1 extra.
    const bd = computeWeekBreakdown(5, 2, 8);
    expect(bd.baselineCompleted).toBe(5);
    expect(bd.debtPaid).toBe(2);
    expect(bd.overachievement).toBe(1);
    expect(bd.endingDebt).toBe(0);
    expect(bd.successful).toBe(true);
  });

  it("creates debt for the unmet baseline", () => {
    const bd = computeWeekBreakdown(5, 0, 4);
    expect(bd.newDebt).toBe(1);
    expect(bd.endingDebt).toBe(1);
    expect(bd.successful).toBe(false);
  });
});

describe("reconcileExecution", () => {
  it("1. a fully completed week creates no debt", () => {
    const goal = makeGoal({ weeklyTarget: 5, createdAt: "2026-06-08T12:00:00.000Z" });
    const ws = weekStart("2026-06-08");
    const result = reconcileExecution({
      goals: [goal],
      completions: completionsForWeek(goal.id, ws, 5),
      periods: [],
      debt: [],
      today: TODAY,
      now: NOW
    });
    expect(result.debt).toHaveLength(0);
    const period = result.periods.find((p) => p.weekStart === ws);
    expect(period?.newDebt).toBe(0);
    expect(period?.successful).toBe(true);
  });

  it("2. a partially completed week creates the correct debt", () => {
    const goal = makeGoal({ weeklyTarget: 5, createdAt: "2026-06-08T12:00:00.000Z" });
    const ws = weekStart("2026-06-08");
    const result = reconcileExecution({
      goals: [goal],
      completions: completionsForWeek(goal.id, ws, 4),
      periods: [],
      debt: [],
      today: TODAY,
      now: NOW
    });
    expect(openDebtFor(result.debt, goal.id)).toBe(1);
  });

  it("3. multiple missed weeks accumulate debt", () => {
    const goal = makeGoal({ weeklyTarget: 5, createdAt: "2026-05-01T12:00:00.000Z" });
    // Three fully-missed ended weeks: May 25, Jun 1, Jun 8.
    const result = reconcileExecution({
      goals: [goal],
      completions: [],
      periods: [],
      debt: [],
      today: TODAY,
      now: NOW
    });
    // From goal creation week through the last ended week, every missed week
    // adds 5 of debt (capped at 50).
    expect(openDebtFor(result.debt, goal.id)).toBeGreaterThanOrEqual(15);
    expect(openDebtFor(result.debt, goal.id)).toBeLessThanOrEqual(50);
  });

  it("4. extra work repays the oldest debt first", () => {
    const goal = makeGoal({ weeklyTarget: 5, createdAt: "2026-06-01T12:00:00.000Z" });
    // Week Jun 1: 0 done → 5 debt. Week Jun 8: 7 done → 5 baseline + 2 to debt.
    const completions = completionsForWeek(goal.id, weekStart("2026-06-08"), 7);
    const result = reconcileExecution({
      goals: [goal],
      completions,
      periods: [],
      debt: [],
      today: TODAY,
      now: NOW
    });
    const oldest = result.debt.find((d) => d.originWeekStart === weekStart("2026-06-01"));
    expect(oldest?.repaidQuantity).toBe(2);
    expect(oldest?.remainingQuantity).toBe(3);
    expect(openDebtFor(result.debt, goal.id)).toBe(3);
  });

  it("5. extra work beyond all debt is recorded as overachievement", () => {
    const goal = makeGoal({ weeklyTarget: 5, createdAt: "2026-06-08T12:00:00.000Z" });
    // Single week, 8 done, no prior debt → 3 overachievement, 0 debt.
    const result = reconcileExecution({
      goals: [goal],
      completions: completionsForWeek(goal.id, weekStart("2026-06-08"), 8),
      periods: [],
      debt: [],
      today: TODAY,
      now: NOW
    });
    const period = result.periods.find((p) => p.weekStart === weekStart("2026-06-08"));
    expect(period?.overachievement).toBe(3);
    expect(openDebtFor(result.debt, goal.id)).toBe(0);
  });

  it("6. debt never exceeds 10× the weekly target", () => {
    const goal = makeGoal({ weeklyTarget: 5, createdAt: "2024-01-01T12:00:00.000Z" });
    // A year+ of fully-missed weeks would be 250+ of debt uncapped.
    const result = reconcileExecution({
      goals: [goal],
      completions: [],
      periods: [],
      debt: [],
      today: TODAY,
      now: NOW
    });
    expect(openDebtFor(result.debt, goal.id)).toBe(50);
  });

  it("7. reconciliation can run twice without duplicate debt", () => {
    const goal = makeGoal({ weeklyTarget: 5, createdAt: "2026-06-01T12:00:00.000Z" });
    const input = {
      goals: [goal],
      completions: completionsForWeek(goal.id, weekStart("2026-06-08"), 2),
      periods: [],
      debt: [],
      today: TODAY,
      now: NOW
    };
    const first = reconcileExecution(input);
    const second = reconcileExecution({ ...input, periods: first.periods, debt: first.debt });
    expect(second.changed).toBe(false);
    expect(second.periods).toHaveLength(first.periods.length);
    expect(openDebtFor(second.debt, goal.id)).toBe(openDebtFor(first.debt, goal.id));
  });

  it("8. removing a completion recalculates the correct totals", () => {
    const goal = makeGoal({ weeklyTarget: 5, createdAt: "2026-06-08T12:00:00.000Z" });
    const all = completionsForWeek(goal.id, weekStart("2026-06-08"), 5);
    const withAll = reconcileExecution({
      goals: [goal],
      completions: all,
      periods: [],
      debt: [],
      today: TODAY,
      now: NOW
    });
    expect(openDebtFor(withAll.debt, goal.id)).toBe(0);

    // Undo one completion and reconcile from scratch (events are the source of truth).
    const withUndo = reconcileExecution({
      goals: [goal],
      completions: all.slice(0, 4),
      periods: [],
      debt: [],
      today: TODAY,
      now: NOW
    });
    expect(openDebtFor(withUndo.debt, goal.id)).toBe(1);
  });

  it("9. daily goals reconcile correctly into weekly totals", () => {
    // 1 post/day → weekly baseline 7. Only 5 days completed → 2 debt.
    const goal = makeGoal({
      id: "g-post",
      title: "Original post",
      category: "X / Twitter",
      frequency: "daily",
      dailyTarget: 1,
      weeklyTarget: 7,
      createdAt: "2026-06-08T12:00:00.000Z"
    });
    const ws = weekStart("2026-06-08");
    const completions = [0, 1, 2, 3, 4].map((offset) => mkCompletion(goal.id, addDays(ws, offset)));
    const result = reconcileExecution({
      goals: [goal],
      completions,
      periods: [],
      debt: [],
      today: TODAY,
      now: NOW
    });
    expect(openDebtFor(result.debt, goal.id)).toBe(2);
    expect(result.periods.find((p) => p.weekStart === ws)?.completed).toBe(5);
  });

  it("10. goal target changes do not alter finalized historical weeks", () => {
    const goal = makeGoal({ weeklyTarget: 5, createdAt: "2026-06-08T12:00:00.000Z" });
    const completions = completionsForWeek(goal.id, weekStart("2026-06-08"), 2);
    const first = reconcileExecution({
      goals: [goal],
      completions,
      periods: [],
      debt: [],
      today: TODAY,
      now: NOW
    });
    const finalizedBaseline = first.periods.find((p) => p.weekStart === weekStart("2026-06-08"))?.baseline;
    expect(finalizedBaseline).toBe(5);

    // Lower the target afterwards and re-run; the finalized snapshot is frozen.
    const editedGoal = { ...goal, weeklyTarget: 2 };
    const second = reconcileExecution({
      goals: [editedGoal],
      completions,
      periods: first.periods,
      debt: first.debt,
      today: TODAY,
      now: NOW
    });
    expect(second.periods.find((p) => p.weekStart === weekStart("2026-06-08"))?.baseline).toBe(5);
  });
});

describe("date handling", () => {
  it("11. Monday-to-Sunday boundaries work correctly", () => {
    // 2026-06-08 is a Monday; 2026-06-14 is the Sunday that ends the same week.
    expect(weekStart("2026-06-08")).toBe("2026-06-08");
    expect(weekStart("2026-06-14")).toBe("2026-06-08");
    expect(weekStart("2026-06-15")).toBe("2026-06-15");
    expect(addDays(weekStart("2026-06-14"), 6)).toBe("2026-06-14");
  });

  it("12. local timezone handling does not shift a completion to another date", () => {
    // A late-evening *local* moment must keep its local calendar day, unlike the
    // classic `new Date(...).toISOString().slice(0,10)` UTC bug.
    const lateLocal = new Date(2026, 5, 14, 23, 30, 0); // Jun 14 2026, 23:30 local
    expect(toLocalDateString(lateLocal)).toBe("2026-06-14");
    const earlyLocal = new Date(2026, 5, 14, 0, 15, 0); // Jun 14 2026, 00:15 local
    expect(toLocalDateString(earlyLocal)).toBe("2026-06-14");
  });
});

describe("perfectDayStreak", () => {
  it("counts only days where every daily goal hit its target", () => {
    const goal = makeGoal({
      id: "g-daily",
      frequency: "daily",
      dailyTarget: 2,
      weeklyTarget: 14,
      createdAt: "2026-06-10T12:00:00.000Z"
    });
    const completions = [
      mkCompletion(goal.id, "2026-06-13", 2),
      mkCompletion(goal.id, "2026-06-14", 2),
      mkCompletion(goal.id, "2026-06-15", 1) // today, not yet complete
    ];
    const streak = perfectDayStreak([goal], completions, "2026-06-10", "2026-06-15");
    // Today is incomplete, so current falls back to the run ending yesterday (2).
    expect(streak.current).toBe(2);
    expect(streak.longest).toBe(2);
  });
});
