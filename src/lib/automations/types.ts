export const AUTOMATION_IDS = ["pipeline", "ingest", "publisher", "threads", "podcast"] as const;

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
