import type { PlatformId, QueueItem, Visibility } from "@/lib/publisher/types";
import { hasBufferDeliveryEvidence, hasDeliveryEvidence } from "./projection";

export type Principal = { ownerId: string; scopes: readonly ("read" | "write" | "review" | "worker")[] };
export type Target = {
  ownerId: string;
  /** Existing authoritative queue/job id, not a new queue row. */
  jobId: string;
  /** An eventual ledger transaction must own this monotonic revision. Legacy 0 is refused. */
  revision: number;
  artifactSha256: string;
  /** Digest of the complete final payload: title, tags, visibility, audience/options, etc. No credentials. */
  payloadSha256: string;
  /** Exact final platform payload, including hashtags/attribution, after transformations. */
  caption: string;
  platform: PlatformId;
  accountId: string;
  visibility: Visibility;
  /** Effective platform audience (e.g. TikTok PUBLIC_TO_EVERYONE / SELF_ONLY). */
  audience: string;
  scheduledAt: string;
};
export type Command = { commandId: string; target: Target };
export type Decision<T> = { ok: true; proposal: T; persisted: false } | { ok: false; reason: string };
const refused = (reason: string): Decision<never> => ({ ok: false, reason });
const proposed = <T>(proposal: T): Decision<T> => ({ ok: true, proposal, persisted: false });
const PLATFORMS: readonly string[] = ["youtube", "instagram", "facebook", "tiktok"];

function validTarget(target: Target): boolean {
  return Boolean(target.ownerId.trim() && target.jobId.trim() && target.accountId.trim() &&
    Number.isSafeInteger(target.revision) && target.revision > 0 &&
    /^[a-f0-9]{64}$/.test(target.artifactSha256) && /^[a-f0-9]{64}$/.test(target.payloadSha256) &&
    ["public", "private", "unlisted"].includes(target.visibility) && target.audience.trim() &&
    target.caption.length > 0 && target.caption.length <= 20_000 &&
    PLATFORMS.includes(target.platform) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(target.scheduledAt) &&
    Number.isFinite(Date.parse(target.scheduledAt)) && new Date(target.scheduledAt).toISOString() === target.scheduledAt);
}

export function sameTarget(a: Target, b: Target): boolean {
  return a.ownerId === b.ownerId && a.jobId === b.jobId && a.revision === b.revision &&
    a.artifactSha256 === b.artifactSha256 && a.payloadSha256 === b.payloadSha256 && a.caption === b.caption && a.platform === b.platform &&
    a.accountId === b.accountId && a.visibility === b.visibility && a.audience === b.audience && a.scheduledAt === b.scheduledAt;
}

function guard(principal: Principal, command: Command, current: Target, scope: "write" | "review" | "worker"): string | undefined {
  if (!principal.ownerId || principal.ownerId !== current.ownerId || command.target.ownerId !== principal.ownerId) return "Owner mismatch.";
  if (!principal.scopes.includes(scope)) return `Missing ${scope} scope.`;
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(command.commandId)) return "A durable command id is required.";
  if (!validTarget(current) || !validTarget(command.target)) return "A verified artifact, final caption, account, canonical time and transactional revision are required.";
  if (!sameTarget(command.target, current)) return "Stale or changed target. Read and review the current revision.";
}

/** A proposal for review only; deliberately no publish grant or enqueue effect. */
export function proposeReview(principal: Principal, command: Command, current: Target): Decision<Command & { kind: "review_only"; grantsPublishing: false }> {
  const error = guard(principal, command, current, "review");
  if (error) return refused(error);
  return proposed({ commandId: command.commandId, target: { ...current }, kind: "review_only", grantsPublishing: false });
}

/** Re-use for edit invalidation and duplicate checks inside a future atomic ledger transaction. */
export function deliveryBarrier(target: Target, queue: readonly QueueItem[]): string | undefined {
  const related = queue.filter((item) => item.id === target.jobId || item.jobId === target.jobId);
  if (related.some(({ buffer }) => hasBufferDeliveryEvidence(buffer))) {
    return "Buffer delivery has started or its outcome is uncertain. Reconcile before any retry.";
  }
  const matches = related.filter((item) => item.platforms[target.platform]);
  // Scope is job/platform, conservatively across accounts. Changing account does not make a retry safe.
  if (matches.length > 1) return "Duplicate job/platform records require reconciliation.";
  const state = matches[0]?.platforms[target.platform];
  if (state && hasDeliveryEvidence(state)) return "Delivery has started or its outcome is uncertain. Reconcile before any retry.";
}

export function proposeEdit(
  principal: Principal, command: Command, current: Target, queue: readonly QueueItem[], instructions: string
): Decision<Command & { kind: "request_edits"; instructions: string; invalidateReview: true }> {
  const error = guard(principal, command, current, "write") ?? deliveryBarrier(current, queue);
  if (error) return refused(error);
  if (!instructions.trim() || instructions.length > 4_000) return refused("Edit instructions must contain 1-4000 characters.");
  return proposed({ commandId: command.commandId, target: { ...current }, kind: "request_edits", instructions, invalidateReview: true });
}

export function proposeRetry(
  principal: Principal, command: Command, current: Target, queue: readonly QueueItem[],
  outcome: "failed_before_send" | "uncertain" | "in_progress" | "accepted" | "published"
): Decision<Command & { kind: "retry_worker"; grantsPublishing: false }> {
  const error = guard(principal, command, current, "write") ?? deliveryBarrier(current, queue);
  if (error) return refused(error);
  if (outcome !== "failed_before_send") return refused("Only a verified failure before sending is eligible for retry.");
  return proposed({ commandId: command.commandId, target: { ...current }, kind: "retry_worker", grantsPublishing: false });
}

export type WorkerReport = Command & { attemptId: string; outcome: "failed" | "uncertain" | "accepted" | "published"; postId?: string };
/** Produced by an authenticated independent platform reader, never deserialized from operation args. */
export type PlatformReadback = {
  target: Target;
  attemptId: string;
  postId: string;
  state: "accepted" | "scheduled" | "published";
  visibility: Visibility;
  audience: string;
  observedAt: string;
  /** Canonical URL returned/validated by that reader; accepted/scheduled are never live. */
  publishedUrl?: string;
  /** Reader attests that resolving the canonical URL identifies this final post id. */
  publishedUrlPostId?: string;
};

function platformUrl(platform: PlatformId, value: string, postId: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
    const host = url.hostname.replace(/^www\./, "");
    if (platform === "youtube") {
      if (host === "youtube.com" && url.pathname === "/watch") return [...url.searchParams.keys()].length === 1 && url.searchParams.get("v") === postId;
      return !url.search && ((host === "youtube.com" && url.pathname === `/shorts/${postId}`) || (host === "youtu.be" && url.pathname === `/${postId}`));
    }
    if (url.search) return false;
    if (platform === "instagram") return host === "instagram.com" && /^\/(p|reel)\/[^/]+\/?$/.test(url.pathname);
    if (platform === "tiktok") return host === "tiktok.com" && /^\/@[^/]+\/video\/\d+\/?$/.test(url.pathname) && url.pathname.split("/")[3] === postId;
    return host === "facebook.com" && /^\/(reel\/\d+|[^/]+\/posts\/[^/]+)\/?$/.test(url.pathname);
  } catch { return false; }
}

/**
 * Readback must be obtained by a trusted port under the same owner/account.
 * This validates a proposal; only an authoritative fenced CAS may record it.
 * A worker assertion, upload id, local render or scheduled receipt is never "published".
 */
export function reconcileWorkerReport(
  principal: Principal, report: WorkerReport, current: Target, readback: PlatformReadback | null, now: Date,
  /** Loaded atomically from the authoritative ledger, never taken from the report. */
  activeAttemptId: string
): Decision<{ kind: "worker_outcome"; commandId: string; target: Target; attemptId: string; outcome: "uncertain" | "accepted" | "published"; postId?: string; publishedUrl?: string; publishedUrlVerified: boolean }> {
  const error = guard(principal, report, current, "worker");
  if (error) return refused(error);
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(report.attemptId) || report.attemptId !== activeAttemptId) return refused("The current fenced attempt id is required.");
  const base = { kind: "worker_outcome" as const, commandId: report.commandId, target: { ...current }, attemptId: report.attemptId };
  // Failed/unknown sends remain uncertain without independent proof. Never rearm here.
  if (!readback) return proposed({ ...base, outcome: "uncertain", publishedUrlVerified: false });
  if (!sameTarget(current, readback.target) || readback.attemptId !== report.attemptId || !readback.postId ||
    (report.postId !== undefined && report.postId !== readback.postId)) return refused("Readback does not match this owner, account, revision and attempt.");
  const observed = Date.parse(readback.observedAt);
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(observed) || observed > now.getTime() || now.getTime() - observed > 300_000) return refused("A fresh platform readback is required.");
  if (!["accepted", "scheduled", "published"].includes(readback.state)) return refused("Unrecognized platform readback state.");
  if (readback.state !== "published") return proposed({ ...base, outcome: "accepted", postId: readback.postId, publishedUrlVerified: false });
  if (readback.visibility !== current.visibility || readback.audience !== current.audience) return refused("Published visibility/audience does not match the reviewed target.");
  if (!readback.publishedUrl || readback.publishedUrlPostId !== readback.postId || !platformUrl(current.platform, readback.publishedUrl, readback.postId)) return refused("A canonical platform URL verified by the reader is required.");
  return proposed({ ...base, outcome: "published", postId: readback.postId, publishedUrl: readback.publishedUrl, publishedUrlVerified: true });
}
