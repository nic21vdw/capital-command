import type {
  AppData,
  ExecutionCategory,
  ExecutionCompletion,
  ExecutionDebtEntry,
  ExecutionGoal,
  ExecutionPeriod
} from "@/types/domain";
import {
  type HeatmapCell,
  type StreakResult,
  type WeekBreakdown,
  activeDayStreak,
  buildHeatmap,
  completionsInRange,
  completionsOnDay,
  computeWeekBreakdown,
  earliestExecutionDate,
  firstExecutionWeek,
  openDebtEntriesFor,
  openDebtFor,
  perfectDayStreak,
  successfulWeekStreak,
  wasTrackedOn
} from "@/lib/execution/calculations";
import { type LocalDate, addDays, eachDay, weekStart } from "@/lib/execution/dates";

export const EXECUTION_CATEGORIES: ExecutionCategory[] = [
  "X / Twitter",
  "Reddit",
  "YouTube",
  "CoLateral",
  "Structural Engineering",
  "Community & Networking"
];

export interface DayState {
  date: LocalDate;
  completed: number;
  target: number;
  isToday: boolean;
  isFuture: boolean;
  met: boolean;
  missed: boolean;
}

export interface TodayTask {
  goal: ExecutionGoal;
  completed: number;
  required: number;
  met: boolean;
  /** True when there is also outstanding weekly debt for this goal. */
  hasDebt: boolean;
}

export interface WeeklyGoalView {
  goal: ExecutionGoal;
  breakdown: WeekBreakdown;
  /** Per-day state (daily goals only) for the current week. */
  days: DayState[];
}

export interface CategoryView {
  category: ExecutionCategory;
  baseline: number;
  baselineCompleted: number;
  completed: number;
  percent: number;
  goalCount: number;
}

export interface DebtByWeek {
  originWeekStart: LocalDate;
  remaining: number;
  original: number;
}

export interface DebtView {
  goal: ExecutionGoal;
  total: number;
  oldestWeek: LocalDate | null;
  byWeek: DebtByWeek[];
  repaidThisWeek: number;
  cap: number;
  percentOfCap: number;
}

export interface WeekGoalRow {
  goal: ExecutionGoal;
  baseline: number;
  startingDebt: number;
  completed: number;
  baselineCompleted: number;
  debtPaid: number;
  newDebt: number;
  endingDebt: number;
  overachievement: number;
  successful: boolean;
}

export interface WeekSummary {
  weekStart: LocalDate;
  weekEnd: LocalDate;
  finalized: boolean;
  isCurrent: boolean;
  baselineRequired: number;
  startingDebt: number;
  completed: number;
  baselineCompleted: number;
  debtRepaid: number;
  newDebt: number;
  endingDebt: number;
  overachievement: number;
  percent: number;
  successful: boolean;
  rows: WeekGoalRow[];
}

export interface ExecutionSummary {
  todayPercent: number;
  weekPercent: number;
  outstandingDebt: number;
  totalCompletionsThisWeek: number;
  activeStreak: StreakResult;
  perfectStreak: StreakResult;
  weeklyStreak: StreakResult;
}

export interface ExecutionView {
  today: LocalDate;
  weekStart: LocalDate;
  weekEnd: LocalDate;
  hasGoals: boolean;
  activeGoals: ExecutionGoal[];
  summary: ExecutionSummary;
  todayTasks: TodayTask[];
  weeklyGoals: WeeklyGoalView[];
  categories: CategoryView[];
  debts: DebtView[];
  heatmap: HeatmapCell[];
  weeks: WeekSummary[];
}

function sortGoals(goals: ExecutionGoal[]): ExecutionGoal[] {
  return [...goals].sort((a, b) =>
    a.displayOrder !== b.displayOrder ? a.displayOrder - b.displayOrder : a.title.localeCompare(b.title)
  );
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

/**
 * Build the entire Execution view model from authoritative app data. All
 * business calculations live here (and in the modules it composes) so React
 * components never recompute debt, streaks, or percentages themselves.
 */
export function buildExecutionView(data: AppData, today: LocalDate): ExecutionView {
  const goals = sortGoals(data.executionGoals);
  const completions = data.executionCompletions;
  const debt = data.executionDebt;
  const periods = data.executionPeriods;

  const ws = weekStart(today);
  const we = addDays(ws, 6);

  const activeGoals = goals.filter((g) => g.active && !g.archivedAt);

  // ----- Weekly goal views (current week) -----
  const weeklyGoals: WeeklyGoalView[] = activeGoals.map((goal) => {
    const startingDebt = openDebtFor(debt, goal.id);
    const completed = completionsInRange(completions, goal.id, ws, we);
    const breakdown = computeWeekBreakdown(goal.weeklyTarget, startingDebt, completed);

    const days: DayState[] =
      goal.frequency === "daily"
        ? eachDay(ws, we).map((date) => {
            const done = completionsOnDay(completions, goal.id, date);
            const isFuture = date > today;
            const met = done >= goal.dailyTarget;
            return {
              date,
              completed: done,
              target: goal.dailyTarget,
              isToday: date === today,
              isFuture,
              met,
              missed: !met && date < today
            };
          })
        : [];

    return { goal, breakdown, days };
  });

  // ----- Today tasks (daily goals tracked today) -----
  const todayTasks: TodayTask[] = activeGoals
    .filter((g) => g.frequency === "daily" && wasTrackedOn(g, today))
    .map((goal) => {
      const completed = completionsOnDay(completions, goal.id, today);
      return {
        goal,
        completed,
        required: goal.dailyTarget,
        met: completed >= goal.dailyTarget,
        hasDebt: openDebtFor(debt, goal.id) > 0
      };
    });

  // ----- Category aggregation -----
  const categories: CategoryView[] = EXECUTION_CATEGORIES.map((category) => {
    const inCategory = weeklyGoals.filter((view) => view.goal.category === category);
    const baseline = inCategory.reduce((sum, view) => sum + view.breakdown.baseline, 0);
    const baselineCompleted = inCategory.reduce((sum, view) => sum + view.breakdown.baselineCompleted, 0);
    const completed = inCategory.reduce((sum, view) => sum + view.breakdown.completed, 0);
    return {
      category,
      baseline,
      baselineCompleted,
      completed,
      percent: baseline === 0 ? (inCategory.length ? 100 : 0) : (baselineCompleted / baseline) * 100,
      goalCount: inCategory.length
    };
  }).filter((c) => c.goalCount > 0);

  // ----- Debt panel (include archived goals that still owe) -----
  const debts: DebtView[] = goals
    .map((goal) => {
      const entries = openDebtEntriesFor(debt, goal.id);
      const total = openDebtFor(debt, goal.id);
      const cap = goal.weeklyTarget * 10;
      const completed = completionsInRange(completions, goal.id, ws, we);
      const breakdown = computeWeekBreakdown(goal.weeklyTarget, total, completed);
      return {
        goal,
        total,
        oldestWeek: entries[0]?.originWeekStart ?? null,
        byWeek: entries.map((entry) => ({
          originWeekStart: entry.originWeekStart,
          remaining: entry.remainingQuantity,
          original: entry.originalQuantity
        })),
        repaidThisWeek: breakdown.debtPaid,
        cap,
        percentOfCap: cap === 0 ? 0 : (total / cap) * 100
      };
    })
    .filter((d) => d.total > 0)
    .sort((a, b) => b.total - a.total);

  // ----- Summary -----
  const dailyToday = todayTasks;
  const todayTargetSum = dailyToday.reduce((sum, t) => sum + t.required, 0);
  const todayDoneSum = dailyToday.reduce((sum, t) => sum + Math.min(t.completed, t.required), 0);
  const todayPercent = todayTargetSum === 0 ? (dailyToday.length ? 100 : 0) : (todayDoneSum / todayTargetSum) * 100;

  const weekBaselineSum = weeklyGoals.reduce((sum, v) => sum + v.breakdown.baseline, 0);
  const weekBaselineDone = weeklyGoals.reduce((sum, v) => sum + v.breakdown.baselineCompleted, 0);
  const weekPercent = weekBaselineSum === 0 ? (weeklyGoals.length ? 100 : 0) : (weekBaselineDone / weekBaselineSum) * 100;

  const totalCompletionsThisWeek = activeGoals.reduce(
    (sum, goal) => sum + completionsInRange(completions, goal.id, ws, we),
    0
  );
  const outstandingDebt = goals.reduce((sum, goal) => sum + openDebtFor(debt, goal.id), 0);

  const start = earliestExecutionDate(goals, completions, today);
  const firstWeek = firstExecutionWeek(goals, completions, today);

  const summary: ExecutionSummary = {
    todayPercent: clampPercent(todayPercent),
    weekPercent: clampPercent(weekPercent),
    outstandingDebt,
    totalCompletionsThisWeek,
    activeStreak: activeDayStreak(completions, start, today),
    perfectStreak: perfectDayStreak(goals, completions, start, today),
    weeklyStreak: successfulWeekStreak(goals, completions, firstWeek, ws)
  };

  // ----- Heatmap (~12 months) -----
  const heatmapStart = addDays(today, -370);
  const heatmap = buildHeatmap(goals, completions, heatmapStart < firstWeek ? firstWeek : heatmapStart, today);

  // ----- Weekly history (finalized periods + current week) -----
  const weeks = buildWeeklyHistory(goals, completions, periods, debt, ws, we);

  return {
    today,
    weekStart: ws,
    weekEnd: we,
    hasGoals: goals.length > 0,
    activeGoals,
    summary,
    todayTasks,
    weeklyGoals,
    categories,
    debts,
    heatmap,
    weeks
  };
}

function buildWeeklyHistory(
  goals: ExecutionGoal[],
  completions: ExecutionCompletion[],
  periods: ExecutionPeriod[],
  debt: ExecutionDebtEntry[],
  currentWeekStart: LocalDate,
  currentWeekEnd: LocalDate
): WeekSummary[] {
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const byWeek = new Map<LocalDate, ExecutionPeriod[]>();
  for (const period of periods) {
    if (!period.finalized) continue;
    const list = byWeek.get(period.weekStart) ?? [];
    list.push(period);
    byWeek.set(period.weekStart, list);
  }

  const summaries: WeekSummary[] = [];

  // Current (in-progress) week, derived live.
  const currentRows: WeekGoalRow[] = goals
    .filter((g) => wasTrackedOn(g, currentWeekStart) || wasTrackedOn(g, currentWeekEnd))
    .map((goal) => {
      const startingDebt = openDebtFor(debt, goal.id);
      const completed = completionsInRange(completions, goal.id, currentWeekStart, currentWeekEnd);
      const breakdown = computeWeekBreakdown(goal.weeklyTarget, startingDebt, completed);
      return {
        goal,
        baseline: breakdown.baseline,
        startingDebt: breakdown.startingDebt,
        completed,
        baselineCompleted: breakdown.baselineCompleted,
        debtPaid: breakdown.debtPaid,
        newDebt: breakdown.newDebt,
        endingDebt: breakdown.endingDebt,
        overachievement: breakdown.overachievement,
        successful: breakdown.successful
      };
    });
  if (currentRows.length > 0) {
    summaries.push(aggregateWeek(currentWeekStart, currentWeekEnd, currentRows, false, true));
  }

  // Finalized weeks (snapshots).
  for (const [weekStartValue, weekPeriods] of byWeek) {
    const rows: WeekGoalRow[] = weekPeriods.map((period) => ({
      goal:
        goalById.get(period.goalId) ??
        ({
          id: period.goalId,
          title: "Archived goal",
          category: "CoLateral",
          frequency: "weekly",
          dailyTarget: 0,
          weeklyTarget: period.baseline,
          icon: "Archive",
          displayOrder: 999,
          active: false,
          createdAt: period.weekStart,
          updatedAt: period.weekStart
        } as ExecutionGoal),
      baseline: period.baseline,
      startingDebt: period.startingDebt,
      completed: period.completed,
      baselineCompleted: period.baselineCompleted,
      debtPaid: period.debtPaid,
      newDebt: period.newDebt,
      endingDebt: period.endingDebt,
      overachievement: period.overachievement,
      successful: period.successful
    }));
    summaries.push(aggregateWeek(weekStartValue, addDays(weekStartValue, 6), rows, true, false));
  }

  return summaries.sort((a, b) => (a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : 0));
}

function aggregateWeek(
  ws: LocalDate,
  we: LocalDate,
  rows: WeekGoalRow[],
  finalized: boolean,
  isCurrent: boolean
): WeekSummary {
  const baselineRequired = rows.reduce((s, r) => s + r.baseline, 0);
  const startingDebt = rows.reduce((s, r) => s + r.startingDebt, 0);
  const completed = rows.reduce((s, r) => s + r.completed, 0);
  const baselineCompleted = rows.reduce((s, r) => s + r.baselineCompleted, 0);
  const debtRepaid = rows.reduce((s, r) => s + r.debtPaid, 0);
  const newDebt = rows.reduce((s, r) => s + r.newDebt, 0);
  const endingDebt = rows.reduce((s, r) => s + r.endingDebt, 0);
  const overachievement = rows.reduce((s, r) => s + r.overachievement, 0);
  return {
    weekStart: ws,
    weekEnd: we,
    finalized,
    isCurrent,
    baselineRequired,
    startingDebt,
    completed,
    baselineCompleted,
    debtRepaid,
    newDebt,
    endingDebt,
    overachievement,
    percent: baselineRequired === 0 ? 100 : (baselineCompleted / baselineRequired) * 100,
    successful: rows.length > 0 && rows.every((r) => r.successful),
    rows: [...rows].sort((a, b) => a.goal.displayOrder - b.goal.displayOrder)
  };
}
