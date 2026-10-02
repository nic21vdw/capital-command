export const AUTOMATION_IDS = ["pipeline", "ingest", "publisher", "threads", "podcast"] as const;

export const AUTOMATION_EVENT_KINDS = ["completed", "failed", "retrying", "delivered", "scheduled", "blocked", "paused", "resumed"] as const;
export type AutomationEventKind = (typeof AUTOMATION_EVENT_KINDS)[number];
export type AutomationHistoryEvent = {
  id: string;
  at: string;
  automationId: AutomationId;
  scope: "worker" | "delivery" | "control";
  kind: AutomationEventKind;
  detail: string;
  itemId?: string;
  destination?: string;
  nextAttemptAt?: string;
};
export type AutomationHistory = {
  from: string;
  to: string;
  events: AutomationHistoryEvent[];
  total: number;
  page: number;
  pages: number;
  counts: { delivered: number; retrying: number; failed: number; workerIssues: number; scheduled: number };
  warnings: string[];
};

export type AutomationId = (typeof AUTOMATION_IDS)[number];
export type AutomationOutcome = {
  at: string;
  status: "completed" | "failed" | "paused";
  detail: string;
};

export type AutomationControl = {
  paused: boolean;
  changedAt: string | null;
};

export type AutomationTask = {
  state: "ready" | "running" | "disabled" | "missing" | "other-checkout" | "unknown";
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastResult: number | null;
  schedule: string | null;
};

export type AutomationCard = {
  id: AutomationId;
  title: string;
  description: string;
  href: string;
  paused: boolean;
  changedAt: string | null;
  state: "paused" | "blocked" | "running" | "ready" | "attention" | "unknown";
  blockers: string[];
  schedule: string;
  timezone: string;
  nextRunAt: string | null;
  nextItemAt: string | null;
  lastRunAt: string | null;
  lastOutcome: string | null;
  taskLastRunAt?: string | null;
  taskLastResult?: number | null;
  counts: { label: string; value: number }[];
  issues: string[];
};

export type AutomationOverview = {
  checkedAt: string;
  cards: AutomationCard[];
  autoScheduleOvernight: boolean;
};
