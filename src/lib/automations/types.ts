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
  /** The publish zone the page should speak in (the API adds it; not part of the journal read). */
  timezone?: string;
  /** Present when the caller asked for a time zone: delivery outcomes since local midnight. */
  today?: { delivered: number; failed: number };
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
  /** Exact command that installs this automation's Windows task, when it has one. */
  registerCommand?: string;
  /** Deep link to the item that most needs a look (failed first, then next due), when there is one. */
  itemHref?: string;
};

/** One line of the Cadence block: a value, and the .env name that sets it. `editable` rows can be changed from the card. */
export type CadenceRow = { label: string; value: string; env: string; note?: string; editable?: boolean };

/**
 * A post a platform already holds. Pausing the publisher does not stop these:
 * YouTube, Facebook and Buffer publish them at their slot by themselves.
 */
export type HeldPost = {
  id: string;
  title: string;
  platform: "YouTube" | "Facebook" | "Buffer";
  status: "uploaded" | "scheduled";
  goesLiveAt: string;
  /** The item in the Uploading Center. */
  href: string;
  /** Where to cancel it on the platform, when a link is known. */
  externalUrl?: string;
  externalLabel?: string;
};

export type AutomationOverview = {
  checkedAt: string;
  cards: AutomationCard[];
  autoScheduleOvernight: boolean;
  cadence: CadenceRow[];
  /** The raw values behind the editable cadence rows, for the Edit form. */
  cadenceValues: { shortsPerDay: number; slotTimes: string[]; weekendSlotTimes: string[] };
  /** Soonest first, capped; `heldTotal` is the full count. */
  held: HeldPost[];
  heldTotal: number;
  /** Delivery outcomes recorded since local midnight. */
  today: { delivered: number; failed: number };
};
