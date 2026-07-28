import type { LaunchPhase } from "@/types/domain";

export type { LaunchCopy, LaunchPhase, LaunchStats, LaunchStatus, ProductLaunch } from "@/types/domain";

export interface LaunchTaskTemplate {
  id: string;
  label: string;
  detail: string;
  phase: LaunchPhase;
  /** Days relative to launch day: -14 is two weeks before, 0 is launch day, +2 is two days after. */
  offsetDays: number;
}

export interface LaunchTask extends LaunchTaskTemplate {
  dueDate: string;
  done: boolean;
  overdue: boolean;
}

export interface LaunchPlanGroup {
  phase: LaunchPhase;
  title: string;
  tasks: LaunchTask[];
}

export interface LaunchPlan {
  groups: LaunchPlanGroup[];
  total: number;
  completed: number;
  nextTask: LaunchTask | null;
  overdueCount: number;
  daysUntilLaunch: number;
}
