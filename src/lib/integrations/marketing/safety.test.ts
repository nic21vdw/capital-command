import { describe, expect, it } from "vitest";
import type { QueueItem } from "@/lib/publisher/types";
import { deliveryBarrier, proposeEdit, proposeRetry, proposeReview, reconcileWorkerReport, type Command, type PlatformReadback, type Principal, type Target, type WorkerReport } from "./safety";

const principal: Principal = { ownerId: "owner-a", scopes: ["read", "write", "review", "worker"] };
const target: Target = {
  ownerId: "owner-a", jobId: "queue-a", revision: 7, artifactSha256: "a".repeat(64),
  payloadSha256: "c".repeat(64), caption: "Exact final caption #tag", platform: "youtube", accountId: "account-a",
  visibility: "public", audience: "public", scheduledAt: "2026-10-23T12:00:00.000Z"
};
const command: Command = { commandId: "command_00000001", target };
const item = (patch: Partial<QueueItem> = {}): QueueItem => ({
  id: target.jobId, clipPath: "synthetic/output.mp4", title: "Synthetic", caption: target.caption, hashtags: [],
  publishAt: target.scheduledAt, visibility: "public", createdAt: "2026-10-20T00:00:00.000Z",
  accountId: target.accountId, platforms: { youtube: { status: "pending", attempts: 0 } }, ...patch
});
const report: WorkerReport = { ...command, attemptId: "attempt_00000001", outcome: "published", postId: "video-id" };
const now = new Date("2026-10-23T12:01:00.000Z");
const proof: PlatformReadback = {
  target, attemptId: report.attemptId, postId: "video-id", state: "published",
  visibility: "public", audience: "public", observedAt: "2026-10-23T12:00:59.000Z",
  publishedUrl: "https://www.youtube.com/watch?v=video-id", publishedUrlPostId: "video-id"
};

describe("review proposal boundary", () => {
  it("binds the exact review tuple without a release or persistence claim", () => {
    expect(proposeReview(principal, command, target)).toEqual({
      ok: true, persisted: false, proposal: { ...command, kind: "review_only", grantsPublishing: false }
    });
  });
  it.each<Partial<Target>>([
    { ownerId: "other" }, { jobId: "other" }, { revision: 6 }, { artifactSha256: "b".repeat(64) },
    { payloadSha256: "d".repeat(64) }, { caption: `${target.caption} ` }, { platform: "instagram" }, { accountId: "other" },
    { visibility: "private" }, { audience: "other" }, { scheduledAt: "2026-10-24T12:00:00.000Z" }
  ])("refuses a stale or changed field %j", (patch) => {
    expect(proposeReview(principal, { ...command, target: { ...target, ...patch } }, target).ok).toBe(false);
  });
  it.each<Partial<Target>>([{ revision: 0 }, { revision: NaN }, { revision: 1.1 }, { artifactSha256: "filename.mp4" }, { scheduledAt: "2026-02-30T12:00:00.000Z" }, { accountId: "" }])("refuses unverifiable legacy target %j", (patch) => {
    const current = { ...target, ...patch };
    expect(proposeReview(principal, { ...command, target: current }, current).ok).toBe(false);
  });
  it("requires the authenticated scope and durable command id", () => {
    expect(proposeReview({ ...principal, scopes: ["read", "write"] }, command, target).ok).toBe(false);
    expect(proposeReview(principal, { ...command, commandId: "short" }, target).ok).toBe(false);
    expect(proposeEdit({ ...principal, scopes: ["read", "review"] }, command, target, [], "edit").ok).toBe(false);
  });
});

describe("edit and retry safety", () => {
  it("proposes an edit with approval invalidation without changing inputs", () => {
    const queue = [item()];
    const before = JSON.stringify({ queue, target });
    expect(proposeEdit(principal, command, target, queue, "Replace the ending")).toMatchObject({
      ok: true, persisted: false, proposal: { kind: "request_edits", invalidateReview: true }
    });
    expect(JSON.stringify({ queue, target })).toBe(before);
  });
  it.each(["", " ", "x".repeat(4001)])("refuses missing or unbounded edit instructions", (instructions) => {
    expect(proposeEdit(principal, command, target, [], instructions).ok).toBe(false);
  });
  it.each([
    { status: "failed" as const, attempts: 1 },
    { status: "failed" as const, attempts: 0, postId: "receipt-survived-failure" },
    { status: "pending" as const, attempts: 0, claimedAt: "2026-10-20T00:00:00Z" },
    { status: "pending" as const, attempts: 0, childContainerIds: ["part"] },
    { status: "uploaded" as const, attempts: 0 },
    { status: "scheduled" as const, attempts: 0 },
    { status: "published" as const, attempts: 0 }
  ])("blocks edit and retry after possible delivery %j", (state) => {
    const queue = [item({ platforms: { youtube: state } })];
    expect(proposeEdit(principal, command, target, queue, "edit").ok).toBe(false);
    expect(proposeRetry(principal, command, target, queue, "failed_before_send").ok).toBe(false);
  });
  it("deduplicates a job/platform even across accounts and queue ids", () => {
    const queue = [item({ jobId: target.jobId }), item({ id: "copy", jobId: target.jobId, accountId: "other" })];
    expect(deliveryBarrier(target, queue)).toMatch(/Duplicate/);
  });
  it("blocks a failed Buffer leg that still carries a receipt", () => {
    expect(proposeRetry(principal, command, target, [item({ buffer: { status: "failed", attempts: 0, updateIds: ["retained-receipt"] } })], "failed_before_send").ok).toBe(false);
  });
  it.each(["uncertain", "in_progress", "accepted", "published"] as const)("never automatically retries %s", (outcome) => {
    expect(proposeRetry(principal, command, target, [], outcome).ok).toBe(false);
  });
  it("allows only an unsent failed worker retry proposal", () => {
    expect(proposeRetry(principal, command, target, [item()], "failed_before_send")).toMatchObject({
      ok: true, persisted: false, proposal: { kind: "retry_worker", grantsPublishing: false }
    });
  });
});

describe("worker outcome reconciliation", () => {
  it("requires a worker scope distinct from user read/write/review permissions", () => {
    expect(reconcileWorkerReport({ ...principal, scopes: ["read", "write", "review"] }, report, target, proof, now, report.attemptId).ok).toBe(false);
  });
  it.each(["failed", "uncertain", "accepted", "published"] as const)("worker %s alone cannot prove publication", (outcome) => {
    expect(reconcileWorkerReport(principal, { ...report, outcome }, target, null, now, report.attemptId)).toMatchObject({
      ok: true, persisted: false, proposal: { outcome: "uncertain", publishedUrlVerified: false }
    });
  });
  it.each(["accepted", "scheduled"] as const)("never calls %s published even after worker success", (state) => {
    expect(reconcileWorkerReport(principal, report, target, { ...proof, state }, now, report.attemptId)).toMatchObject({
      ok: true, proposal: { outcome: "accepted", publishedUrlVerified: false }
    });
  });
  it("uses independently matched platform readback instead of the worker status", () => {
    expect(reconcileWorkerReport(principal, { ...report, outcome: "uncertain" }, target, proof, now, report.attemptId)).toMatchObject({
      ok: true, persisted: false, proposal: { outcome: "published", publishedUrlVerified: true, postId: "video-id" }
    });
  });
  it.each<Partial<PlatformReadback>>([
    { target: { ...target, ownerId: "other" } }, { target: { ...target, accountId: "other" } },
    { target: { ...target, revision: 8 } }, { attemptId: "older_attempt_0001" }, { postId: "other" },
    { observedAt: "2026-10-23T11:00:00Z" }, { observedAt: "2026-10-23T13:00:00Z" },
    { publishedUrl: "javascript:alert(1)" }, { publishedUrl: "https://youtube.com.attacker.invalid/watch?v=video-id" },
    { publishedUrl: "https://user:password@youtube.com/watch?v=video-id" }, { publishedUrl: undefined },
    { publishedUrl: "https://youtube.com/watch?v=other" }, { publishedUrl: "https://youtu.be/" },
    { publishedUrlPostId: "other" }, { visibility: "private" }, { audience: "other" }
  ])("rejects mismatched or unverified evidence %j", (patch) => {
    expect(reconcileWorkerReport(principal, report, target, { ...proof, ...patch }, now, report.attemptId).ok).toBe(false);
  });
  it("fences an older worker even when its target and readback otherwise match", () => {
    expect(reconcileWorkerReport(principal, report, target, proof, now, "newer_attempt_0002").ok).toBe(false);
  });
});
