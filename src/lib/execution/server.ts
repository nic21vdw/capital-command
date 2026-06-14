import { buildDefaultExecutionGoals } from "@/lib/execution/defaults";
import { reconcileExecution } from "@/lib/execution/reconcile";
import { type LocalDate, todayLocal } from "@/lib/execution/dates";
import type { AppData } from "@/types/domain";

export interface EnsureResult {
  data: AppData;
  changed: boolean;
}

/**
 * Server-authoritative bootstrap for execution data. This is the single place
 * where default goals are seeded and ended weeks are reconciled into debt, so
 * the dashboard never relies on the client to create debt.
 *
 * Both steps are idempotent:
 *  - Seeding is gated on `executionSeededAt`, so default goals are created once
 *    and never duplicated, even if the user later archives or deletes them all.
 *  - Reconciliation skips already-finalized weeks (see reconcileExecution).
 */
export function ensureExecution(data: AppData, today: LocalDate = todayLocal()): EnsureResult {
  const now = new Date().toISOString();
  let changed = false;

  let goals = data.executionGoals;

  // 1. Seed default goals exactly once.
  if (!data.executionSeededAt && goals.length === 0) {
    goals = buildDefaultExecutionGoals(now);
    changed = true;
  }

  // 2. Finalize any ended weeks.
  const reconciled = reconcileExecution({
    goals,
    completions: data.executionCompletions,
    periods: data.executionPeriods,
    debt: data.executionDebt,
    today,
    now
  });

  if (!changed && !reconciled.changed) {
    return { data, changed: false };
  }

  return {
    data: {
      ...data,
      executionGoals: goals,
      executionPeriods: reconciled.periods,
      executionDebt: reconciled.debt,
      executionSeededAt: data.executionSeededAt ?? now
    },
    changed: true
  };
}
