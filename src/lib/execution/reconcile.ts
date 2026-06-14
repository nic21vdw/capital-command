import type {
  ExecutionCompletion,
  ExecutionDebtEntry,
  ExecutionGoal,
  ExecutionPeriod
} from "@/types/domain";
import {
  completionsInRange,
  computeWeekBreakdown,
  goalCreatedDate,
  openDebtEntriesFor
} from "@/lib/execution/calculations";
import { type LocalDate, addDays, weekStart } from "@/lib/execution/dates";

export interface ReconcileInput {
  goals: ExecutionGoal[];
  completions: ExecutionCompletion[];
  periods: ExecutionPeriod[];
  debt: ExecutionDebtEntry[];
  /** Local "today" used to decide which weeks have fully ended. */
  today: LocalDate;
  /** ISO timestamp used for finalizedAt / createdAt (injectable for tests). */
  now: string;
}

export interface ReconcileResult {
  periods: ExecutionPeriod[];
  debt: ExecutionDebtEntry[];
  changed: boolean;
}

const MAX_WEEKS = 600; // ~11.5 years of safety headroom against runaway loops.

/**
 * Idempotently finalize every ended-but-unfinalized week for every goal.
 *
 * Safety / correctness properties:
 *  - Only weeks strictly *before* the current week are finalized (`ws < currentWeek`),
 *    so the in-progress week and TZ-edge boundaries are never finalized early.
 *  - A `(goalId, weekStart)` key set prevents re-finalizing an already finalized
 *    week, so running this twice never creates duplicate debt or periods.
 *  - Debt ledger entries use deterministic ids keyed by goal+week, a second
 *    layer of duplicate protection.
 *  - Debt repayments are applied to the oldest open ledger entries first.
 *  - The debt cap (10× baseline) is enforced inside `computeWeekBreakdown`.
 *
 * Archived goals are still reconciled so their history finalizes correctly, but
 * they create no *new* requirements after their archive date.
 */
export function reconcileExecution(input: ReconcileInput): ReconcileResult {
  const { goals, completions, today, now } = input;
  const periods = input.periods.map((p) => ({ ...p }));
  const debt = input.debt.map((d) => ({ ...d }));

  const finalizedKeys = new Set(
    periods.filter((p) => p.finalized).map((p) => `${p.goalId}:${p.weekStart}`)
  );
  const currentWeek = weekStart(today);
  let changed = false;

  for (const goal of goals) {
    // Determine the earliest relevant week: the earlier of the goal's creation
    // week and the week of its earliest completion.
    let earliest = weekStart(goalCreatedDate(goal));
    for (const completion of completions) {
      if (completion.goalId !== goal.id) continue;
      const cw = weekStart(completion.date);
      if (cw < earliest) earliest = cw;
    }

    let ws = earliest;
    let guard = 0;
    while (ws < currentWeek && guard < MAX_WEEKS) {
      guard += 1;
      const key = `${goal.id}:${ws}`;
      if (!finalizedKeys.has(key)) {
        const we = addDays(ws, 6);
        const baseline = goal.weeklyTarget;
        const startingDebt = openDebtEntriesFor(debt, goal.id).reduce(
          (sum, entry) => sum + entry.remainingQuantity,
          0
        );
        const completed = completionsInRange(completions, goal.id, ws, we);
        const breakdown = computeWeekBreakdown(baseline, startingDebt, completed);

        // Apply debt repayment to the oldest open entries first.
        let toPay = breakdown.debtPaid;
        for (const entry of openDebtEntriesFor(debt, goal.id)) {
          if (toPay <= 0) break;
          const pay = Math.min(toPay, entry.remainingQuantity);
          entry.remainingQuantity -= pay;
          entry.repaidQuantity += pay;
          if (entry.remainingQuantity <= 0) entry.fullyRepaidAt = now;
          toPay -= pay;
        }

        // Record any new debt created this week.
        if (breakdown.newDebt > 0) {
          debt.push({
            id: `xdebt-${goal.id}-${ws}`,
            goalId: goal.id,
            originWeekStart: ws,
            originalQuantity: breakdown.newDebt,
            remainingQuantity: breakdown.newDebt,
            repaidQuantity: 0,
            createdAt: now
          });
        }

        periods.push({
          id: `xperiod-${goal.id}-${ws}`,
          goalId: goal.id,
          weekStart: ws,
          weekEnd: we,
          baseline,
          startingDebt,
          effectiveRequired: breakdown.effectiveRequired,
          completed,
          baselineCompleted: breakdown.baselineCompleted,
          debtPaid: breakdown.debtPaid,
          newDebt: breakdown.newDebt,
          endingDebt: breakdown.endingDebt,
          overachievement: breakdown.overachievement,
          successful: breakdown.successful,
          finalized: true,
          finalizedAt: now
        });

        finalizedKeys.add(key);
        changed = true;
      }
      ws = addDays(ws, 7);
    }
  }

  return { periods, debt, changed };
}
