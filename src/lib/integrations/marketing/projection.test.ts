import { describe, expect, it } from "vitest";
import type { ClipJob } from "@/lib/clipping/types";
import type { PipelineRun } from "@/lib/pipeline/types";
import type { QueueItem } from "@/lib/publisher/types";
import { projectExistingLedger } from "./projection";

const run: PipelineRun = { id: "run-a", name: "Synthetic stream", status: "running", notices: [], sourceId: "source-a", sourceUrl: "https://example.invalid/video", createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z" };
const job: ClipJob = { id: "clip-a", fileName: "Synthetic source", sourceId: "source-a", sourceUrl: "upload://source-a", status: "done", stage: "finished", progress: 100, notices: [], createdAt: run.createdAt, clips: [] };
const queued: QueueItem = { id: "queued-a", jobId: job.id, runId: run.id, clipPath: "C:/private/source.mp4", title: "Synthetic clip", caption: "Exact caption", hashtags: [], publishAt: "2026-10-23T12:00:00Z", visibility: "public", createdAt: run.createdAt, platforms: { youtube: { status: "published", attempts: 1, postId: "an-id", publishedAt: run.createdAt }, instagram: { status: "failed", attempts: 1, containerId: "in-flight", error: "secret token raw response" } } };
const owned = <T>(record: T, ownerId = "owner-a") => ({ ownerId, record });

describe("existing ledger projection", () => {
  it("joins only owner-scoped existing records, without changing or manufacturing receipts/revisions", () => {
    const snapshot = { runs: [owned(run), owned({ ...run, id: "private", name: "Other owner" }, "other")], clipJobs: [owned(job)], queue: [owned(queued), owned({ ...queued, id: "private", title: "Other owner" }, "other")] };
    const before = JSON.stringify(snapshot);
    const result = projectExistingLedger("owner-a", snapshot);
    expect(result.sources).toEqual([{ id: "source-a", title: "Synthetic stream", sourceUrl: run.sourceUrl }]);
    expect(result.jobs.map((entry) => entry.id)).toEqual(["clip:clip-a", "publish:queued-a:youtube", "publish:queued-a:instagram"]);
    expect(result.jobs.every((entry) => entry.revision === 0 && !entry.revisionVerified && !entry.publishedUrlVerified)).toBe(true);
    expect(result.jobs[1].status).toBe("reported_published");
    expect(result.jobs[2]).toMatchObject({ status: "reconciliation_required", error: { outcome: "uncertain", retryable: false } });
    expect(Object.values(result.capabilities).every((value) => value === false)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/Other owner|private\/source|secret token|in-flight|an-id/);
    expect(JSON.stringify(snapshot)).toBe(before);
    result.jobs[0].title = "Projection edit";
    expect(job.fileName).toBe("Synthetic source");
  });
  it("never infers an owner from a queue account id", () => {
    expect(projectExistingLedger("account-a", { runs: [], clipJobs: [], queue: [owned({ ...queued, accountId: "account-a" })] }).jobs).toEqual([]);
    expect(() => projectExistingLedger(" ", { runs: [], clipJobs: [], queue: [] })).toThrow(/owner/);
  });
  it("requires reconciliation for a pending direct leg with an existing Buffer receipt", () => {
    const buffered: QueueItem = { ...queued, platforms: { tiktok: { status: "pending", attempts: 0 } }, buffer: { status: "failed", attempts: 0, updateIds: ["synthetic-receipt"] } };
    expect(projectExistingLedger("owner-a", { runs: [], clipJobs: [], queue: [owned(buffered)] }).jobs[0]).toMatchObject({ status: "reconciliation_required", error: { outcome: "uncertain", retryable: false } });
  });
  it.each(["upload://source", "file:///C:/private/source.mp4", "https://user:secret@example.invalid/video", "https://example.invalid/video?token=secret", "https://example.invalid/video#secret"])("does not expose sensitive or local source urls", (sourceUrl) => {
    const result = projectExistingLedger("owner-a", { runs: [owned({ ...run, sourceUrl })], clipJobs: [], queue: [] });
    expect(result.sources[0].sourceUrl).toBeUndefined();
  });
});
