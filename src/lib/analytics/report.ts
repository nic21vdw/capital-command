import type { PlatformTotals, PostRow } from "@/lib/analytics/query";
import type { AccountSync, SyncResult } from "@/lib/analytics/types";

export type SyncSummary = {
  lastAttemptAt: string | null;
  lastCompletedAt: string | null;
  lastResult: SyncResult | null;
  lastError: string | null;
  running: boolean;
  nextDueAt: string | null;
};

export type AnalyticsReport = {
  generatedAt: string;
  sync: SyncSummary;
  accounts: AccountSync[];
  posts: PostRow[];
  totals: { last7: PlatformTotals[]; last28: PlatformTotals[] };
};
