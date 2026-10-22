import { createHash, randomUUID } from "node:crypto";
import { itemAccountId } from "@/lib/publisher/accounts";
import type { PublishQueue } from "@/lib/publisher/queue";
import type { MarketingCommandResult, PlatformId, QueueItem } from "@/lib/publisher/types";
import { hasBufferDeliveryEvidence, hasDeliveryEvidence } from "./projection";
import { proposeReview, reconcileWorkerReport, sameTarget, type Command, type PlatformReadback, type Principal, type Target } from "./safety";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, field]) => [key, canonical(field)]));
  return value;
}
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

/** Detects foreign payload, file-reference, scheduling and delivery changes; harmless UI/save timestamps are excluded. */
export function fingerprintQueueItem(item: QueueItem): string {
  const { marketing: _marketing, updatedAt: _updatedAt, failedSeenAt: _failedSeenAt, ...fields } = item;
  void [_marketing, _updatedAt, _failedSeenAt];
  return digest(fields);
}

/**
 * Called by the queue merge. Disk owns integration metadata, never a stale
 * caller-held copy. Managed deletions become tombstones in the SAME queue row.
 */
export function preserveManagedRows(
  merged: Map<string, QueueItem>, stored: ReadonlyMap<string, QueueItem>, base: ReadonlyMap<string, string>
): Map<string, QueueItem> {
  const prior = new Map<string, QueueItem>();
  for (const [id, text] of base) {
    const item = JSON.parse(text) as QueueItem;
    if (item.marketing) prior.set(id, item);
  }
  for (const [id, item] of stored) if (item.marketing) prior.set(id, item);
  for (const [id, item] of merged) if (item.marketing && !prior.has(id)) prior.set(id, item);
  for (const [id, previous] of prior) {
    const previousState = previous.marketing!;
    let item = merged.get(id);
    const deleted = !item || (base.has(id) && !stored.has(id));
    if (!item) { item = structuredClone(previous); merged.set(id, item); }
    const state = structuredClone(previousState);
    const fingerprint = fingerprintQueueItem(item);
    if (fingerprint !== state.fingerprint || (deleted && !state.deletedAt)) {
      state.revision += 1;
      state.review = undefined;
      if (state.worker) { state.worker.state = "uncertain"; state.worker.publishedUrlVerified = false; }
      if (deleted) state.deletedAt ??= new Date().toISOString();
    }
    state.fingerprint = fingerprint;
    state.publication = "blocked";
    item.marketing = state;
  }
  return merged;
}

export class MarketingLedgerError extends Error {
  constructor(readonly code: "forbidden" | "not_found" | "conflict" | "invalid" | "unavailable", message: string) { super(message); }
}
export type LedgerBinding = { ownerId: string; allowedAccounts: Partial<Record<PlatformId, readonly string[]>> };
export type ArtifactEvidence = {
  sha256: string; finalCaption: string; payloadSha256: string;
  /** Trusted, synchronous identity/stat check immediately before the locked transition. */
  assertCurrent?: () => void;
};
export type OutcomeArgs = Command & { attemptId: string; outcome: "prepared" | "failed_before_send" | "uncertain" | "accepted" | "published"; postId?: string };
export type LedgerPorts = {
  /** Trusted local bytes + final publisher payload verifier. Never operation-body evidence. */
  readArtifact(item: Readonly<QueueItem>, platform: PlatformId): Promise<ArtifactEvidence>;
  /** Independent authenticated reader. Never accept a supplied readback or arbitrary URL. */
  readback?(target: Target, attemptId: string, postId?: string): Promise<PlatformReadback | null>;
  /** Trusted processing worker attests it failed before any external send. A report alone is insufficient. */
  verifyPreSendFailure?(item: Readonly<QueueItem>, attemptId: string): Promise<boolean>;
  /** Independent processing receipt proves preparation completed without an external send. */
  verifyPreparation?(item: Readonly<QueueItem>, attemptId: string): Promise<boolean>;
  now?: () => Date;
};
export type ManagedJob = {
  id: string; jobId: string; title: string; platform: PlatformId; revision: number; revisionVerified: true;
  status: string; reviewed: boolean; target: Target; artifactSha256: string; caption: string; scheduledAt: string;
  attemptId?: string;
  publishedUrl?: string; publishedUrlVerified: boolean; error?: { message: string; outcome: "failed" | "uncertain"; retryable: boolean };
};
const fail = (code: MarketingLedgerError["code"], message: string): never => { throw new MarketingLedgerError(code, message); };
const receiptLimit = 256;

/** Durable operations over existing queue rows. There is deliberately no publish/enqueue/send operation. */
export class MarketingLedger {
  constructor(private readonly queue: PublishQueue, private readonly binding: LedgerBinding, private readonly ports: LedgerPorts) {
    if (!binding.ownerId.trim() || !Object.values(binding.allowedAccounts).some((accounts) => accounts?.length)) fail("invalid", "An explicit owner and account binding are required.");
  }
  private now(): Date { return this.ports.now?.() ?? new Date(); }
  private authorize(principal: Principal, scope: Principal["scopes"][number]): void {
    if (principal.ownerId !== this.binding.ownerId || !principal.scopes.includes(scope)) fail("forbidden", "Owner or operation scope does not match the trusted connection.");
  }
  private scoped(item: QueueItem, ownerId: string, allowUnmanaged = false): boolean {
    return (allowUnmanaged ? !item.marketing || item.marketing.ownerId === ownerId : item.marketing?.ownerId === ownerId) &&
      Object.keys(item.platforms).length > 0 && (Object.keys(item.platforms) as PlatformId[]).every((platform) => this.binding.allowedAccounts[platform]?.includes(itemAccountId(item, platform)));
  }
  private require(rows: ReadonlyMap<string, QueueItem>, principal: Principal, id: string, allowUnmanaged = false): QueueItem {
    const item = rows.get(id);
    if (!item || !this.scoped(item, principal.ownerId, allowUnmanaged) || item.marketing?.deletedAt) return fail("not_found", "Job not found in this owner/account scope.");
    return item;
  }
  private async evidence(item: QueueItem, platform: PlatformId): Promise<ArtifactEvidence> {
    const value = await this.ports.readArtifact(structuredClone(item), platform);
    if (!/^[a-f0-9]{64}$/.test(value.sha256) || !/^[a-f0-9]{64}$/.test(value.payloadSha256) || !value.finalCaption || value.finalCaption.length > 20_000) fail("invalid", "The artifact bytes and final payload could not be verified.");
    return value;
  }
  private target(item: QueueItem, platform: PlatformId, evidence: ArtifactEvidence): Target {
    if (!item.platforms[platform]) return fail("not_found", "Platform leg not found.");
    return { ownerId: this.binding.ownerId, jobId: item.id, revision: item.marketing!.revision,
      artifactSha256: evidence.sha256, payloadSha256: evidence.payloadSha256, caption: evidence.finalCaption,
      platform, accountId: itemAccountId(item, platform), visibility: item.visibility,
      audience: platform === "tiktok" ? item.tiktok?.privacyLevel ?? "inbox" : item.visibility,
      scheduledAt: new Date(item.publishAt).toISOString() };
  }
  private async snapshot(principal: Principal, id: string, platform: PlatformId): Promise<{ item: QueueItem; evidence: ArtifactEvidence; target: Target }> {
    const item = structuredClone(this.require(new Map((await this.queue.list()).map((row) => [row.id, row])), principal, id));
    if (!item.platforms[platform]) return fail("not_found", "Platform leg not found.");
    const evidence = await this.evidence(item, platform);
    return { item, evidence, target: this.target(item, platform, evidence) };
  }
  private replay(rows: ReadonlyMap<string, QueueItem>, principal: Principal, commandId: string, requestHash: string): MarketingCommandResult | undefined {
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(commandId)) return fail("invalid", "A durable command id is required.");
    for (const item of rows.values()) {
      if (item.marketing?.ownerId !== principal.ownerId) continue;
      const receipt = item.marketing.commands[commandId];
      if (!receipt) continue;
      if (!this.scoped(item, principal.ownerId)) return fail("not_found", "Job not found in this owner/account scope.");
      if (receipt.requestHash !== requestHash) return fail("conflict", "This command id was already used with different arguments.");
      return structuredClone(receipt.result);
    }
  }
  private finish(item: QueueItem, operation: MarketingCommandResult["operation"], commandId: string, requestHash: string): MarketingCommandResult {
    const state = item.marketing!;
    if (Object.keys(state.commands).length >= receiptLimit) return fail("conflict", "This job's durable command receipt limit has been reached.");
    state.revision += 1;
    state.fingerprint = fingerprintQueueItem(item);
    state.publication = "blocked";
    const result: MarketingCommandResult = { jobId: item.id, revision: state.revision, operation, persisted: true,
      reviewed: Boolean(state.review), ...(state.worker ? { workerState: state.worker.state, attemptId: state.worker.attemptId } : {}) };
    state.commands[commandId] = { requestHash, result: structuredClone(result) };
    return result;
  }
  private unchanged(item: QueueItem, snapshot: QueueItem): void {
    if (fingerprintQueueItem(item) !== fingerprintQueueItem(snapshot) || item.marketing!.revision !== snapshot.marketing!.revision) fail("conflict", "Job changed while verifying its artifact. Read the current revision.");
  }
  private unsent(item: QueueItem): boolean {
    return !hasBufferDeliveryEvidence(item.buffer) && Object.values(item.platforms).every((leg) => !leg || !hasDeliveryEvidence(leg));
  }

  /** Internal enrollment only, never an HTTP/MCP operation. No caller may assign ledger ownership. */
  async adopt(principal: Principal, args: { commandId: string; jobId: string; expectedFingerprint: string }): Promise<MarketingCommandResult> {
    this.authorize(principal, "write");
    const requestHash = digest({ operation: "adopt", args });
    return this.queue.managedTransaction((rows) => {
      const replay = this.replay(rows, principal, args.commandId, requestHash);
      if (replay) return { value: replay, changed: false };
      const item = this.require(rows, principal, args.jobId, true);
      if (item.marketing || !this.unsent(item) || fingerprintQueueItem(item) !== args.expectedFingerprint) return fail("conflict", "Only an unchanged, unsent, scoped existing item can be enrolled.");
      item.marketing = { schema: 1, ownerId: this.binding.ownerId, revision: 0, fingerprint: fingerprintQueueItem(item), publication: "blocked", commands: {} };
      return { value: this.finish(item, "adopt", args.commandId, requestHash), changed: true };
    });
  }

  async read(principal: Principal, jobId: string, platform: PlatformId): Promise<ManagedJob> {
    this.authorize(principal, "read");
    const { item, target } = await this.snapshot(principal, jobId, platform);
    const state = item.marketing!;
    const worker = state.worker;
    return { id: `publish:${item.id}:${platform}`, jobId: item.id, title: item.title, platform, revision: state.revision,
      revisionVerified: true, target, artifactSha256: target.artifactSha256, caption: target.caption, scheduledAt: target.scheduledAt,
      reviewed: Boolean(state.review && sameTarget(state.review.target, target)), status: worker?.state ?? (state.edit ? "edits_requested" : "awaiting_review"),
      ...(worker ? { attemptId: worker.attemptId } : {}),
      publishedUrlVerified: worker?.state === "published" && worker.publishedUrlVerified === true,
      ...(worker?.publishedUrlVerified ? { publishedUrl: worker.publishedUrl } : {}),
      ...(worker?.state === "uncertain" || worker?.state === "failed_before_send" ? { error: { message: worker.state === "uncertain" ? "Outcome requires independent reconciliation." : "Processing failed before sending.", outcome: worker.state === "uncertain" ? "uncertain" as const : "failed" as const, retryable: worker.state === "failed_before_send" } } : {}) };
  }
  async list(principal: Principal): Promise<ManagedJob[]> {
    this.authorize(principal, "read");
    const jobs: ManagedJob[] = [];
    for (const item of await this.queue.list()) {
      if (!this.scoped(item, principal.ownerId) || item.marketing?.deletedAt) continue;
      for (const platform of Object.keys(item.platforms) as PlatformId[]) jobs.push(await this.read(principal, item.id, platform));
    }
    return jobs;
  }

  private async command(
    principal: Principal, args: Command, operation: MarketingCommandResult["operation"], scope: Principal["scopes"][number],
    extra: unknown, apply: (item: QueueItem, current: Target, rows: Map<string, QueueItem>) => void,
    options: { allowChangedArtifact?: boolean; before?: (item: QueueItem) => Promise<void> } = {}
  ): Promise<MarketingCommandResult> {
    this.authorize(principal, scope);
    const requestHash = digest({ operation, args, extra });
    // A restart/replay needs no artifact or network port; original receipt remains authoritative.
    const prior = await this.queue.managedTransaction((rows) => ({ value: this.replay(rows, principal, args.commandId, requestHash), changed: false }));
    if (prior) return prior;
    const snapshot = await this.snapshot(principal, args.target.jobId, args.target.platform);
    const expectedBeforeVerification = options.allowChangedArtifact && snapshot.item.marketing?.worker?.target ? snapshot.item.marketing.worker.target : snapshot.target;
    if (!sameTarget(args.target, expectedBeforeVerification)) return fail("conflict", "The exact target changed before verification.");
    await options.before?.(snapshot.item);
    return this.queue.managedTransaction((rows) => {
      const replay = this.replay(rows, principal, args.commandId, requestHash);
      if (replay) return { value: replay, changed: false };
      const item = this.require(rows, principal, args.target.jobId);
      this.unchanged(item, snapshot.item);
      const current = this.target(item, args.target.platform, snapshot.evidence);
      const expected = options.allowChangedArtifact && item.marketing?.worker?.target ? item.marketing.worker.target : current;
      if (!sameTarget(args.target, expected)) return fail("conflict", "The exact artifact, final payload, account, time or revision changed.");
      snapshot.evidence.assertCurrent?.();
      apply(item, current, rows);
      const value = this.finish(item, operation, args.commandId, requestHash);
      if (operation === "review") item.marketing!.review!.target.revision = value.revision;
      if ((operation === "claim" || operation === "record_outcome") && item.marketing!.worker) item.marketing!.worker!.target = { ...current, revision: value.revision };
      return { value, changed: true };
    });
  }
  async review(principal: Principal, args: Command): Promise<MarketingCommandResult> {
    return this.command(principal, args, "review", "review", null, (item, current) => {
      const verdict = proposeReview(principal, args, current);
      if (!verdict.ok) return fail("conflict", verdict.reason);
      if (item.marketing?.worker?.state === "claimed" || item.marketing?.worker?.state === "uncertain") return fail("conflict", "Processing or reconciliation is still in progress.");
      item.marketing!.review = { target: { ...current }, at: this.now().toISOString() };
    });
  }
  async requestEdits(principal: Principal, args: Command & { instructions: string }): Promise<MarketingCommandResult> {
    if (!args.instructions.trim() || args.instructions.length > 4_000) return fail("invalid", "Edit instructions must contain 1-4000 characters.");
    return this.command(principal, args, "request_edits", "write", args.instructions, (item) => {
      if (!this.unsent(item) || (item.marketing?.worker && !["prepared", "failed_before_send"].includes(item.marketing.worker.state))) return fail("conflict", "An active or uncertain attempt cannot be edited.");
      item.marketing!.review = undefined;
      item.marketing!.edit = { instructions: args.instructions, at: this.now().toISOString() };
      item.marketing!.worker = undefined;
    });
  }
  async retry(principal: Principal, args: Command): Promise<MarketingCommandResult> {
    return this.command(principal, args, "retry", "write", null, (item) => {
      if (!this.unsent(item) || item.marketing?.worker?.state !== "failed_before_send") return fail("conflict", "Only a verified failure before sending can be retried.");
      item.marketing.review = undefined;
      item.marketing.worker = undefined;
    });
  }
  async claim(principal: Principal, args: Command): Promise<MarketingCommandResult> {
    return this.command(principal, args, "claim", "worker", null, (item, current, rows) => {
      if (!this.unsent(item) || (item.marketing?.worker && !["prepared", "failed_before_send"].includes(item.marketing.worker.state))) return fail("conflict", "A worker is active or its outcome requires reconciliation.");
      for (const other of rows.values()) {
        if (other.id === item.id || other.marketing?.ownerId !== principal.ownerId) continue;
        const previous = other.marketing.worker;
        if (previous && previous.target?.artifactSha256 === current.artifactSha256 && previous.target.platform === current.platform && !["prepared", "failed_before_send"].includes(previous.state)) return fail("conflict", "This output/platform already has an active or uncertain attempt, including on another account.");
      }
      item.marketing!.review = undefined;
      item.marketing!.worker = { attemptId: randomUUID(), fence: item.marketing!.revision + 1, state: "claimed", claimedAt: this.now().toISOString(), target: current };
    });
  }
  async recordOutcome(principal: Principal, args: OutcomeArgs): Promise<MarketingCommandResult> {
    let proof: PlatformReadback | null = null;
    let failedBeforeSend = false;
    let preparedWithoutSend = false;
    return this.command(principal, args, "record_outcome", "worker", { attemptId: args.attemptId, outcome: args.outcome, postId: args.postId }, (item, current) => {
      const worker = item.marketing!.worker;
      if (!worker || worker.attemptId !== args.attemptId || worker.target?.revision !== args.target.revision) return fail("conflict", "The worker attempt was fenced or superseded.");
      if (["prepared", "failed_before_send", "published"].includes(worker.state)) return fail("conflict", "This worker attempt is already terminal.");
      if (worker.postId && args.postId && worker.postId !== args.postId) return fail("conflict", "The accepted provider receipt cannot be replaced by a worker report.");
      if ((args.outcome === "prepared" || args.outcome === "failed_before_send") && worker.state !== "claimed") return fail("conflict", "An accepted or uncertain attempt requires independent reconciliation before any pre-send outcome.");
      item.marketing!.review = undefined;
      if (args.outcome === "prepared") {
        if (!preparedWithoutSend) return fail("conflict", "Preparation requires a verified processing receipt with no external send.");
        worker.state = "prepared";
      } else if (args.outcome === "failed_before_send" && failedBeforeSend) worker.state = "failed_before_send";
      else {
        const verdict = reconcileWorkerReport(principal, { ...args, postId: args.postId ?? worker.postId, outcome: args.outcome === "failed_before_send" ? "failed" : args.outcome }, args.target, proof, this.now(), worker.attemptId);
        if (!verdict.ok) return fail("conflict", verdict.reason);
        worker.state = verdict.proposal.outcome;
        worker.postId = verdict.proposal.postId ?? worker.postId;
        worker.publishedUrl = verdict.proposal.publishedUrl;
        worker.publishedUrlVerified = verdict.proposal.publishedUrlVerified;
      }
      // A verified prepared output can have new bytes; all previous reviews remain invalidated.
      void current;
    }, { allowChangedArtifact: args.outcome === "prepared", before: async (item) => {
      if (!item.marketing?.worker || item.marketing.worker.attemptId !== args.attemptId || item.marketing.worker.target?.revision !== args.target.revision) return fail("conflict", "The worker attempt was fenced or superseded.");
      if ((args.outcome === "prepared" || args.outcome === "failed_before_send") && item.marketing.worker.state !== "claimed") return fail("conflict", "An accepted or uncertain attempt requires independent reconciliation before any pre-send outcome.");
      if (args.outcome === "prepared") preparedWithoutSend = await this.ports.verifyPreparation?.(item, args.attemptId) === true;
      if (args.outcome === "failed_before_send") failedBeforeSend = await this.ports.verifyPreSendFailure?.(item, args.attemptId) === true;
      if (item.marketing.worker.postId && args.postId && item.marketing.worker.postId !== args.postId) return fail("conflict", "The accepted provider receipt cannot be replaced by a worker report.");
      if (args.outcome === "accepted" || args.outcome === "published" || args.outcome === "uncertain") proof = await this.ports.readback?.(args.target, args.attemptId, args.postId ?? item.marketing.worker.postId) ?? null;
    } });
  }
}
