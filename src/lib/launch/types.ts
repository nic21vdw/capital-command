import type { LaunchPhase } from "@/types/domain";

export type { LaunchCopy, LaunchPhase, LaunchStats, LaunchStatus, ProductLaunch } from "@/types/domain";

/**
 * Which list a task belongs to. "producthunt" is the original playbook (ids
 * `ph-*`); "directory" is the directory and community submissions around it
 * (ids `dir-*`). Absent means "producthunt", which keeps every template written
 * before families existed reading the same.
 */
export type LaunchTaskFamily = "producthunt" | "directory";

export interface LaunchTaskTemplate {
  id: string;
  label: string;
  detail: string;
  phase: LaunchPhase;
  /** Days relative to launch day: -14 is two weeks before, 0 is launch day, +2 is two days after. */
  offsetDays: number;
  family?: LaunchTaskFamily;
  /** Where the submission happens, for directory tasks. */
  url?: string;
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
  /** The Product Hunt playbook, by phase. */
  groups: LaunchPlanGroup[];
  /** Directory and community submissions, in date order. */
  directories: LaunchTask[];
  total: number;
  completed: number;
  nextTask: LaunchTask | null;
  overdueCount: number;
  daysUntilLaunch: number;
}
