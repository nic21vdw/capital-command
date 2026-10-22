import { DEFAULT_SHORTS_PER_DAY } from "@/lib/publisher/shortsCap";
import type { PlatformId } from "@/lib/publisher/types";

export const MARKETING_OPERATIONS = ["create_source", "request_edits", "approve_job", "retry_job", "record_worker_outcome"] as const;
export type MarketingOperation = (typeof MARKETING_OPERATIONS)[number];

export type WorkspaceJob = {
  id: string;
  title: string;
  sourceId?: string;
  status: string;
  /** Zero means the legacy ledger has no transactional revision. Never writable. */
  revision: number;
  revisionVerified: false;
  caption?: string;
  platform?: PlatformId;
  scheduledAt?: string;
  publishedUrlVerified: false;
  error?: { message: string; retryable: false; outcome: "failed" | "uncertain" };
};

export type Workspace = {
  connection: { state: "unavailable" | "read_only"; message: string };
  sources: { id: string; title: string; sourceUrl?: string }[];
  jobs: WorkspaceJob[];
  policy: { configuredDailyCap: number | null; codeDefaultDailyCap: number; historicalPreferenceDailyCap: number };
  capabilities: { createSource: false; requestEdits: false; approveJob: false; retryJob: false; recordWorkerOutcome: false };
};

export const CONNECTION_UNAVAILABLE = "No authenticated, owner-scoped Capital Command worker connection has been verified. No ledger was read or changed.";

/** This is a capability response, never a live status poll. No env switch enables it. */
export function unavailableWorkspace(): Workspace {
  return {
    connection: { state: "unavailable", message: CONNECTION_UNAVAILABLE },
    sources: [],
    jobs: [],
    policy: {
      configuredDailyCap: null,
      codeDefaultDailyCap: DEFAULT_SHORTS_PER_DAY,
      historicalPreferenceDailyCap: 3
    },
    capabilities: { createSource: false, requestEdits: false, approveJob: false, retryJob: false, recordWorkerOutcome: false }
  };
}
