import type {
  ExecutionCompletion,
  ExecutionDebtEntry,
  ExecutionGoal
} from "@/types/domain";
import { type LocalDate, addDays, toLocalDateString, weekStart } from "@/lib/execution/dates";

/** Debt cap multiplier: outstanding debt is capped at 10× the weekly baseline. */
export const DEBT_CAP_MULTIPLIER = 10;

/**
 * The allocation breakdown for a single goal over a single week. Completions are
 * allocated in a fixed priority order:
 *   1. the current baseline requirement,
 *   2. the oldest outstanding debt,
 *   3. additional overachievement.
 */
export interface WeekBreakdown {
  baseline: number;
  startingDebt: number;
  /** baseline + startingDebt — everything owed this week. */
  effectiveRequired: number;
  completed: number;
  baselineCompleted: number;
  /** Portion of baseline still unmet this week. */
  remainingBaseline: number;
  debtPaid: number;
  overachievement: number;
  /** New debt created this week (unmet baseline), after applying the debt cap. */
  newDebt: number;
  /** Outstanding debt at the end of the week. */
  endingDebt: number;
  /** Effective requirement still outstanding (baseline + debt not yet met). */
  remaining: number;
  /** Whether the baseline was fully met (debt repayment is tracked separately). */
  successful: boolean;
  cap: number;
  /** Percentage of the debt cap currently reached (0–100). */
  percentOfCap: number;
  /** Overall completion percentage against the effective requirement (0–100+). */
  percentComplete: number;
}

/**
 * Core debt allocation for one goal/week. Pure and deterministic — this single
 * function powers both live (current-week) display and weekly reconciliation,
 * guaranteeing the numbers shown always match the numbers persisted.
 */
export function computeWeekBreakdown(
  baselineInput: number,
  startingDebtInput: number,
  completedInput: number
): WeekBreakdown {
  const baseline = Math.max(0, baselineInput);
  const startingDebt = Math.max(0, startingDebtInput);
  const completed = Math.max(0, completedInput);

  const cap = baseline * DEBT_CAP_MULTIPLIER;
  const effectiveRequired = baseline + startingDebt;

  // 1. Baseline first.
  const baselineCompleted = Math.min(completed, baseline);
  const remainingBaseline = baseline - baselineCompleted;
  const afterBaseline = completed - baselineCompleted;

  // 2. Then the oldest outstanding debt.
  const debtPaid = Math.min(afterBaseline, startingDebt);

  // 3. Anything left over is overachievement.
  const overachievement = afterBaseline - debtPaid;

  // New debt is the unmet baseline, but the *total* outstanding debt may never
  // exceed the cap. We only ever clamp newly created debt (oldest debt is never
  // silently erased), so endingDebt = debtAfterPayment + newDebt stays <= cap.
  const debtAfterPayment = startingDebt - debtPaid;
  const maxNewDebt = Math.max(0, cap - debtAfterPayment);
  const newDebt = Math.min(remainingBaseline, maxNewDebt);
  const endingDebt = debtAfterPayment + newDebt;

  const remaining = Math.max(0, effectiveRequired - completed);
  const percentComplete = effectiveRequired === 0 ? 100 : (completed / effectiveRequired) * 100;
  const percentOfCap = cap === 0 ? 0 : (endingDebt / cap) * 100;

  return {
    baseline,
    startingDebt,
    effectiveRequired,
    completed,
    baselineCompleted,
    remainingBaseline,
    debtPaid,
    overachievement,
    newDebt,
    endingDebt,
    remaining,
    successful: baselineCompleted >= baseline,
    cap,
    percentOfCap,
    percentComplete
  };
}

// ---------------------------------------------------------------------------
// Goal helpers
// ---------------------------------------------------------------------------

/** Per-day target used for daily breakdowns and heatmap normalization. */
export function dailyTargetFor(goal: ExecutionGoal): number {
  return goal.frequency === "daily" ? goal.dailyTarget : goal.weeklyTarget / 7;
}

/** Local date a goal was created on. */
export function goalCreatedDate(goal: ExecutionGoal): LocalDate {
  return toLocalDateString(new Date(goal.createdAt));
}

/**
 * Whether a goal was being tracked on a given date — used for *historical*
 * calculations (heatmap, streaks). Archived goals retain their history up to the
 * day they were archived, so their past activity never disappears from reports.
 */
export function wasTrackedOn(goal: ExecutionGoal, date: LocalDate): boolean {
  if (goalCreatedDate(goal) > date) return false;
  if (goal.archivedAt && toLocalDateString(new Date(goal.archivedAt)) < date) return false;
  return true;
}

/** Sum of completion quantities for a goal within an inclusive date range. */
export function completionsInRange(
  completions: ExecutionCompletion[],
  goalId: string,
  start: LocalDate,
  end: LocalDate
): number {
  return completions.reduce(
    (sum, entry) =>
      entry.goalId === goalId && entry.date >= start && entry.date <= end
        ? sum + entry.quantity
        : sum,
    0
  );
}

/** Sum of completion quantities for a goal on a single day. */
export function completionsOnDay(
  completions: ExecutionCompletion[],
  goalId: string,
  date: LocalDate
): number {
  return completionsInRange(completions, goalId, date, date);
}

/** Current outstanding debt for a goal (sum of open ledger remainders). */
export function openDebtFor(debt: ExecutionDebtEntry[], goalId: string): number {
  return debt.reduce(
    (sum, entry) => (entry.goalId === goalId ? sum + Math.max(0, entry.remainingQuantity) : sum),
    0
  );
}

/** Open debt entries for a goal, oldest origin week first. */
export function openDebtEntriesFor(debt: ExecutionDebtEntry[], goalId: string): ExecutionDebtEntry[] {
  return debt
    .filter((entry) => entry.goalId === goalId && entry.remainingQuantity > 0)
    .sort((a, b) => (a.originWeekStart < b.originWeekStart ? -1 : a.originWeekStart > b.originWeekStart ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

export interface StreakResult {
  current: number;
  longest: number;
}

/**
 * Generic day-streak calculator. `qualifies` decides whether a day counts.
 *
 * - longest: the longest run of consecutive qualifying days anywhere in range.
 * - current: the run ending at `today`. If today does not (yet) qualify we fall
 *   back to the run ending *yesterday*, so an unfinished current day never
 *   prematurely zeroes an otherwise live streak.
 */
export function streakFromDays(
  start: LocalDate,
  today: LocalDate,
  qualifies: (date: LocalDate) => boolean
): StreakResult {
  let longest = 0;
  let run = 0;
  let cursor = start;
  while (cursor <= today) {
    if (qualifies(cursor)) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
    cursor = addDays(cursor, 1);
  }

  let current = 0;
  let head = qualifies(today) ? today : addDays(today, -1);
  while (head >= start && qualifies(head)) {
    current += 1;
    head = addDays(head, -1);
  }

  return { current, longest };
}

/** A day is "active" if at least one tracked completion was recorded. */
export function activeDayStreak(
  completions: ExecutionCompletion[],
  start: LocalDate,
  today: LocalDate
): StreakResult {
  const activeDays = new Set(completions.filter((c) => c.quantity > 0).map((c) => c.date));
  return streakFromDays(start, today, (date) => activeDays.has(date));
}

/**
 * A day is "perfect" if every daily goal tracked that day met its daily target.
 * Days with no daily goals tracked do not count as perfect (nothing to perfect).
 */
export function perfectDayStreak(
  goals: ExecutionGoal[],
  completions: ExecutionCompletion[],
  start: LocalDate,
  today: LocalDate
): StreakResult {
  const dailyGoals = goals.filter((g) => g.frequency === "daily");
  return streakFromDays(start, today, (date) => {
    const tracked = dailyGoals.filter((g) => wasTrackedOn(g, date));
    if (tracked.length === 0) return false;
    return tracked.every((g) => completionsOnDay(completions, g.id, date) >= g.dailyTarget);
  });
}

/**
 * A week is "successful" if every goal tracked that week met its baseline.
 * Debt repayment is intentionally ignored here — it is tracked separately and
 * does not prevent a week from counting as a baseline success.
 */
export function successfulWeekStreak(
  goals: ExecutionGoal[],
  completions: ExecutionCompletion[],
  firstWeek: LocalDate,
  currentWeek: LocalDate
): StreakResult {
  const weekQualifies = (ws: LocalDate): boolean => {
    const we = addDays(ws, 6);
    const tracked = goals.filter((g) => wasTrackedOn(g, we) || wasTrackedOn(g, ws));
    if (tracked.length === 0) return false;
    return tracked.every((g) => completionsInRange(completions, g.id, ws, we) >= g.weeklyTarget);
  };

  // Walk week-by-week. The in-progress current week only counts once its
  // baselines are actually met (grace otherwise falls back to the prior week).
  let longest = 0;
  let run = 0;
  let cursor = firstWeek;
  while (cursor <= currentWeek) {
    if (weekQualifies(cursor)) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
    cursor = addDays(cursor, 7);
  }

  let current = 0;
  let head = weekQualifies(currentWeek) ? currentWeek : addDays(currentWeek, -7);
  while (head >= firstWeek && weekQualifies(head)) {
    current += 1;
    head = addDays(head, -7);
  }

  return { current, longest };
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

export interface HeatmapCell {
  date: LocalDate;
  /** Raw count of completions logged that day across all goals. */
  count: number;
  /** Normalized 0–1 completion score relative to that day's active targets. */
  score: number;
  /** Discrete intensity level 0–4 (0 = no activity). */
  level: number;
}

/**
 * Build a contribution-style heatmap over a date range.
 *
 * Intensity uses a *normalized* score rather than a raw count so high-volume
 * goals (e.g. X replies) cannot drown out lower-frequency but important goals:
 * each tracked goal contributes `min(1, completed / dailyTarget)` and the day's
 * score is the average across the goals tracked that day. Level 0 is reserved
 * for genuinely empty days so zero activity is always visually distinct from a
 * small amount of low activity (level 1).
 */
export function buildHeatmap(
  goals: ExecutionGoal[],
  completions: ExecutionCompletion[],
  start: LocalDate,
  today: LocalDate
): HeatmapCell[] {
  const cells: HeatmapCell[] = [];
  let cursor = start;
  while (cursor <= today) {
    const tracked = goals.filter((g) => wasTrackedOn(g, cursor));
    let count = 0;
    let scoreSum = 0;
    for (const goal of tracked) {
      const done = completionsOnDay(completions, goal.id, cursor);
      count += done;
      const target = dailyTargetFor(goal);
      scoreSum += target > 0 ? Math.min(1, done / target) : done > 0 ? 1 : 0;
    }
    // Also count completions for goals not currently tracked-on (defensive).
    if (tracked.length === 0) {
      count = completions
        .filter((c) => c.date === cursor)
        .reduce((sum, c) => sum + c.quantity, 0);
    }
    const score = tracked.length > 0 ? scoreSum / tracked.length : 0;

    let level = 0;
    if (count > 0) {
      if (score >= 0.999) level = 4;
      else if (score >= 0.66) level = 3;
      else if (score >= 0.33) level = 2;
      else level = 1;
    }

    cells.push({ date: cursor, count, score, level });
    cursor = addDays(cursor, 1);
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Shared bootstrapping
// ---------------------------------------------------------------------------

/**
 * The earliest local date relevant to execution history: the earliest of any
 * goal's creation date and any completion's date. Used to bound streak/heatmap
 * iteration. Falls back to `today` when there is no history yet.
 */
export function earliestExecutionDate(
  goals: ExecutionGoal[],
  completions: ExecutionCompletion[],
  today: LocalDate
): LocalDate {
  let earliest: LocalDate | null = null;
  for (const goal of goals) {
    const created = goalCreatedDate(goal);
    if (!earliest || created < earliest) earliest = created;
  }
  for (const completion of completions) {
    if (!earliest || completion.date < earliest) earliest = completion.date;
  }
  return earliest ?? today;
}

/** First Monday-week relevant to execution history. */
export function firstExecutionWeek(
  goals: ExecutionGoal[],
  completions: ExecutionCompletion[],
  today: LocalDate
): LocalDate {
  return weekStart(earliestExecutionDate(goals, completions, today));
}
