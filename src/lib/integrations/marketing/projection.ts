import type { ClipJob } from "@/lib/clipping/types";
import type { PipelineRun } from "@/lib/pipeline/types";
import type { BufferState, PlatformId, PlatformState, QueueItem } from "@/lib/publisher/types";
import { unavailableWorkspace, type Workspace, type WorkspaceJob } from "./contract";

/** Assigned by a trusted connection boundary, never from request args/accountId. */
export type Owned<T> = { ownerId: string; record: T };
export type ExistingLedgerSnapshot = {
  runs: readonly Owned<PipelineRun>[];
  clipJobs: readonly Owned<ClipJob>[];
  queue: readonly Owned<QueueItem>[];
};

/** A stored handle or attempted send is not proof of publication or safe retry. */
export function hasDeliveryEvidence(state: PlatformState): boolean {
  return Boolean(
    state.attempts > 0 || state.claimedAt || state.postId || state.containerId || state.childContainerIds?.length ||
    state.uploadedAt || state.publishedAt || ["uploaded", "scheduled", "published"].includes(state.status)
  );
}

export function hasBufferDeliveryEvidence(state: BufferState | undefined): boolean {
  return Boolean(state && (state.attempts > 0 || state.claimedAt || state.updateIds?.length || state.scheduledAt ||
    state.publishedAt || ["scheduled", "published"].includes(state.status)));
}

function publicSourceUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    // Do not leak userinfo, signed query strings, upload:// ids or filesystem paths.
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return undefined;
    return url.href;
  } catch { return undefined; }
}

/**
 * Pure projection over copies obtained by an eventual authenticated in-process
 * reader. It never imports a store, runs.ts, runOverview, enqueue or a runner.
 * Legacy timestamps, file names and post ids cannot manufacture CAS or receipts.
 */
export function projectExistingLedger(ownerId: string, snapshot: ExistingLedgerSnapshot): Workspace {
  if (!ownerId.trim()) throw new Error("An authenticated owner is required.");
  const workspace = unavailableWorkspace();
  workspace.connection = { state: "read_only", message: "Existing ledger projection only. Legacy records have no verified command revision or publication readback; mutations are unavailable." };
  const runs = snapshot.runs.filter((entry) => entry.ownerId === ownerId).map((entry) => entry.record);
  const jobs = snapshot.clipJobs.filter((entry) => entry.ownerId === ownerId).map((entry) => entry.record);
  const queue = snapshot.queue.filter((entry) => entry.ownerId === ownerId).map((entry) => entry.record);
  const sourceNames = new Map<string, Workspace["sources"][number]>();
  for (const run of runs) {
    const id = run.sourceId ?? `run:${run.id}`;
    sourceNames.set(id, { id, title: run.name, sourceUrl: publicSourceUrl(run.sourceUrl) });
  }
  for (const job of jobs) {
    const sourceId = job.sourceId ?? `clip-source:${job.id}`;
    if (!sourceNames.has(sourceId)) sourceNames.set(sourceId, { id: sourceId, title: job.fileName, sourceUrl: publicSourceUrl(job.sourceUrl) });
    workspace.jobs.push({
      id: `clip:${job.id}`, title: job.fileName, sourceId, status: job.status,
      revision: 0, revisionVerified: false, publishedUrlVerified: false,
      ...(job.error ? { error: { message: "Clip processing failed. Check the local job for details.", retryable: false as const, outcome: "failed" as const } } : {})
    });
  }
  for (const item of queue) {
    for (const [platform, state] of Object.entries(item.platforms) as [PlatformId, PlatformState][]) {
      if (!state || !["youtube", "instagram", "tiktok", "facebook"].includes(platform)) continue;
      const uncertain = state.status !== "published" && (hasDeliveryEvidence(state) || hasBufferDeliveryEvidence(item.buffer));
      const projected: WorkspaceJob = {
        id: `publish:${item.id}:${platform}`, title: item.title,
        sourceId: jobs.find((job) => job.id === item.jobId)?.sourceId,
        // Even legacy "published" is a ledger report, not a verified live URL.
        status: uncertain ? "reconciliation_required" : state.status === "published" ? "reported_published" : state.status,
        revision: 0, revisionVerified: false, caption: item.caption,
        platform, scheduledAt: item.publishAt, publishedUrlVerified: false
      };
      if (uncertain || state.error) projected.error = {
        message: uncertain ? "Delivery may have started. Reconcile with the platform before any retry." : "Publishing failed. Check the local job for details.",
        retryable: false, outcome: uncertain ? "uncertain" : "failed"
      };
      workspace.jobs.push(projected);
    }
  }
  workspace.sources = [...sourceNames.values()];
  return workspace;
}
