import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContainerPendingError, postToThreads, readThreadsVideoPost, ThreadsVideoProcessingError } from "@/lib/threads/api";
import { uploadDir } from "@/lib/publisher/uploads";
import { threadsConfig, type ThreadsAccount, type ThreadsConfig } from "@/lib/threads/config";
import { editItemText, pruneOld, rescheduleItem, retryItem, shiftBatch } from "@/lib/threads/queue";
import { runDue, type ThreadsRunDeps } from "@/lib/threads/runner";
import type { ThreadsQueueItem } from "@/lib/threads/types";
import { planVideoBooking, readThreadsExport, videoBookingMatches, videoDeliveryProfile, videoDigest, videoReplay, videoTarget } from "@/lib/threads/video";

const account: ThreadsAccount = {
  id: "primary", label: "Fixture", userId: "100", accessToken: "fixture-secret", posts: "text", offsetMinutes: 0
};
const config: ThreadsConfig = { ...threadsConfig(), timezone: "America/Toronto", enabled: true, videoOnly: true, accounts: [account] };
const before = new Date("2026-11-19T16:00:00Z");
const due = new Date("2026-11-19T16:30:00Z");
const target = videoTarget({
  jobId: "fixture-job", fileName: "export-fixture.mp4", text: "Exact fixture copy.\nSecond line.",
  accountId: account.id, publishAt: due.toISOString()
}, { userId: "100", username: "fixture" }, { sha256: "a".repeat(64) }, config, before);
const cmd = "f24c9cd6-e55f-4d51-86eb-54b910fc7fcd";
const approved = () => planVideoBooking([], target, account, cmd, before);
const signed = "https://fixture.invalid/video?signature=fixture-secret";
const permalink = "https://www.threads.com/@fixture/post/demo123";
const fixtureWork = { permalink, providerTimestamp: due.toISOString() };
const plainLog = () => undefined;
const profile = () => Response.json({ id: "100", username: "fixture" });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("exact local Threads video bookings", () => {
  it("pins bytes, full text, account, time and a bounded delivery window and replays the same ID", () => {
    const row = approved();
    expect(row.video?.target.latestAt).toBe("2026-11-19T16:40:00.000Z");
    expect(videoBookingMatches(row)).toBe(true);
    expect(videoReplay([row], cmd, target)).toEqual(row);
    expect(() => videoReplay([row], cmd, { ...target, text: "Different" })).toThrow("different post");
    expect(() => planVideoBooking([row], target, account, "new-command", before)).toThrow("already has a booking");
    expect(() => planVideoBooking([row], { ...target, sha256: "b".repeat(64) }, account, "new", before)).toThrow("at this time");
    const legacy = { ...row, video: undefined, id: "legacy", text: "Legacy text" };
    expect(() => planVideoBooking([legacy], target, account, "new", before)).toThrow("at this time");
    expect(videoBookingMatches({ ...row, text: "Different" })).toBe(false);
    expect(videoBookingMatches({ ...row, publishAt: "2026-11-19T16:50:00Z" })).toBe(false);
    expect(videoBookingMatches({ ...row, approvedAt: undefined })).toBe(false);
    expect(videoDigest({ ...target, userId: "999" })).not.toBe(videoDigest(target));
  });

  it("keeps immutable video rows out of edit, retry, shift and retention and preserves the old text row", () => {
    const row = approved();
    const legacy = { ...row, id: "plain", video: undefined };
    const rows = [row, legacy];
    expect(editItemText(rows, row.id, "changed").changed).toBe(0);
    expect(rescheduleItem(rows, row.id, new Date(due.getTime() + 3600_000).toISOString()).changed).toBe(0);
    expect(retryItem(rows, row.id, before).changed).toBe(0);
    expect(shiftBatch(rows, row.batchDate, 5).changed).toBe(1);
    expect(row.publishAt).toBe(target.publishAt);
    const farPastRetention = new Date("2027-01-01T00:00:00Z");
    expect(pruneOld(rows, farPastRetention, config)).toEqual([row]);
  });

  it("reads and binds only the exact final MP4 in the existing private upload directory", async () => {
    const id = "12345678-123";
    const root = uploadDir(id);
    await mkdir(root, { recursive: true });
    const file = path.join(root, "export-threads.mp4");
    const fixture = Buffer.alloc(2048);
    await writeFile(file, fixture);
    await expect(readThreadsExport(`upload-${id}`, "export-threads.mp4")).rejects.toThrow("Choose an MP4");
    fixture.write("ftyp", 4);
    await writeFile(file, fixture);
    const first = await readThreadsExport(`upload-${id}`, "export-threads.mp4");
    fixture[12] = 1;
    await writeFile(file, fixture);
    const second = await readThreadsExport(`upload-${id}`, "export-threads.mp4");
    expect(first.bytes[12]).toBe(0);
    expect(second.sha256).not.toEqual(first.sha256);
    await expect(readThreadsExport("../data", "export-threads.mp4")).rejects.toThrow("finished MP4");
  });

  it("requires an explicitly named existing private R2 bucket and refuses the public host configuration", () => {
    vi.stubEnv("S3_ENDPOINT", "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com");
    vi.stubEnv("S3_BUCKET", "fixture");
    vi.stubEnv("S3_ACCESS_KEY_ID", "fake-key");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "fake-secret");
    expect(videoDeliveryProfile()).toBeNull();
    vi.stubEnv("THREADS_PRIVATE_VIDEO_BUCKET", "fixture");
    expect(videoDeliveryProfile()?.bucket).toBe("fixture");
    vi.stubEnv("S3_PUBLIC_BASE_URL", "https://fixture.example");
    expect(videoDeliveryProfile()).toBeNull();
  });
});

describe("official Meta transport, with every request intercepted", () => {
  it("creates a video container, reuses it after processing and sends once after the durable guard", async () => {
    const fetch = vi.fn()
      .mockImplementationOnce(profile).mockResolvedValueOnce(Response.json({ id: "200" }))
      .mockResolvedValueOnce(Response.json({ status: "IN_PROGRESS" }))
      .mockImplementationOnce(profile).mockResolvedValueOnce(Response.json({ status: "FINISHED" }))
      .mockResolvedValueOnce(Response.json({ id: "300" }));
    vi.stubGlobal("fetch", fetch);
    const stage = vi.fn(async () => signed);
    const stored = vi.fn(async () => undefined);
    const guarded = vi.fn(async () => undefined);
    const input = { account, text: target.text, video: { target, stage }, onContainerCreated: stored, onBeforePublish: guarded };
    await expect(postToThreads(input, config)).rejects.toBeInstanceOf(ThreadsVideoProcessingError);
    expect(stored).toHaveBeenCalledWith("200");
    expect(guarded).not.toHaveBeenCalled();
    expect(await postToThreads({ ...input, containerId: "200" }, config)).toEqual({ containerId: "200", postId: "300" });
    const create = fetch.mock.calls[1];
    const publish = fetch.mock.calls[5];
    expect(new URL(create[0]).pathname).toBe("/v1.0/100/threads");
    expect(Object.fromEntries(create[1].body)).toMatchObject({ media_type: "VIDEO", text: target.text, video_url: signed });
    expect(create[1].redirect).toBe("error");
    expect(new URL(publish[0]).pathname).toBe("/v1.0/100/threads_publish");
    expect(publish[1].redirect).toBe("error");
    expect(guarded.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[5]);
    expect(stage).toHaveBeenCalledTimes(1);
  });

  it("does not hand media to an unofficial host or leak an echoed signed URL", async () => {
    const fetch = vi.fn().mockImplementationOnce(profile).mockResolvedValueOnce(new Response(signed, { status: 400 }));
    vi.stubGlobal("fetch", fetch);
    const stage = vi.fn(async () => signed);
    const input = { account, text: target.text, video: { target, stage } };
    await expect(postToThreads(input, { ...config, apiBase: "https://wrong.invalid" })).rejects.toThrow("official Meta");
    expect(fetch).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
    await expect(postToThreads(input, config)).rejects.toThrow(/^Threads rejected the video container creation\.$/);
  });

  it("holds a lost send and verifies a separate proof only for the same media ID, profile, text and time", async () => {
    const verified = {
      id: "300", owner: { id: "100" }, username: "fixture", media_type: "VIDEO", text: target.text,
      timestamp: due.toISOString(), permalink, shortcode: "demo123"
    };
    const fetch = vi.fn().mockImplementationOnce(profile)
      .mockResolvedValueOnce(Response.json({ status: "FINISHED" }))
      .mockRejectedValueOnce(new Error("Fixture response lost"))
      .mockImplementationOnce(profile).mockResolvedValueOnce(Response.json(verified))
      .mockImplementationOnce(profile).mockResolvedValueOnce(Response.json({ ...verified, owner: { id: "999" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(postToThreads({ account, text: target.text, containerId: "200", video: { target, stage: async () => signed } }, config))
      .rejects.toBeInstanceOf(ContainerPendingError);
    await expect(readThreadsVideoPost(account, target, "300", config)).resolves.toEqual(fixtureWork);
    await expect(readThreadsVideoPost(account, target, "300", config)).rejects.toThrow("readback");
  });
});

describe("existing worker video-only dispatch", () => {
  const oldText = () => ({
    ...approved(), id: "old-text", video: undefined, text: "Existing text queue",
    publishAt: "2025-11-18T12:00:00.000Z", createdAt: "2025-11-18T11:00:00.000Z"
  });
  function worker(rows: ThreadsQueueItem[], post: ThreadsRunDeps["post"], proof: ThreadsRunDeps["readVideo"]) {
    let ledger = structuredClone(rows);
    const deps: ThreadsRunDeps = {
      read: async () => structuredClone(ledger), write: async (next) => { ledger = structuredClone(next); },
      post, readVideo: proof, cleanupVideo: vi.fn(async () => undefined)
    };
    return { deps, snapshot: () => ledger };
  }

  it("leaves old text untouched, persists acceptance before separate proof, and never resends on readback retry", async () => {
    const video = approved();
    const legacy = oldText();
    const post = vi.fn<ThreadsRunDeps["post"]>(async (input) => {
      expect(input.video?.target).toEqual(target);
      await input.onContainerCreated?.("200");
      await input.onBeforePublish?.("200");
      return { containerId: "200", postId: "300" };
    });
    const proof = vi.fn<NonNullable<ThreadsRunDeps["readVideo"]>>();
    const harness = worker([legacy, video], post, proof);
    proof.mockImplementationOnce(async () => {
      expect(harness.snapshot().find((row) => row.id === video.id)).toMatchObject({ status: "pending", postId: "300" });
      throw new Error("Synthetic readback failed");
    }).mockResolvedValueOnce(fixtureWork);
    await runDue(due, { config, deps: harness.deps, log: plainLog });
    expect(harness.snapshot().find((row) => row.id === legacy.id)).toEqual(legacy);
    await runDue(new Date(due.getTime() + 5 * 60_000), { config, deps: harness.deps, log: plainLog });
    expect(harness.snapshot().find((row) => row.id === video.id)).toMatchObject({
      status: "published", postId: "300", video: { permalink }
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(harness.deps.cleanupVideo).toHaveBeenCalledTimes(1);
  });

  it("fences a worker that lost its lease while preparing a video", async () => {
    const row = approved();
    let latest = structuredClone(row);
    let attempts = 0;
    const deps: ThreadsRunDeps = {
      read: async () => [structuredClone(latest)],
      write: async (items) => { latest = structuredClone(items[0]); },
      claim: async (_id, prepare) => {
        const previous = structuredClone(latest);
        if (prepare(previous)) latest = previous;
        return structuredClone(latest);
      },
      post: async (input) => {
        await input.onContainerCreated?.("200");
        latest.videoLeaseId = "different-worker";
        latest.claimedAt = new Date(due.getTime() + 1000).toISOString();
        await input.onBeforePublish?.("200");
        attempts++;
        return { containerId: "200", postId: "300" };
      }
    };
    await runDue(due, { config, deps, log: plainLog });
    expect(attempts).toBe(0);
    expect(latest.videoLeaseId).toBe("different-worker");
    expect(latest.publishAttemptedAt).toBeUndefined();
  });

  it("keeps uncertainty fenced after a restart and leaves video out of text mode", async () => {
    const post = vi.fn<ThreadsRunDeps["post"]>(async (input) => {
      await input.onContainerCreated?.("200");
      await input.onBeforePublish?.("200");
      throw new ContainerPendingError("200", "Fixture timeout");
    });
    const harness = worker([approved()], post, undefined);
    await runDue(due, { config: { ...config, videoOnly: false }, deps: harness.deps, log: plainLog });
    expect(post).not.toHaveBeenCalled();
    await runDue(due, { config, deps: harness.deps, log: plainLog });
    const replay = worker(harness.snapshot(), post, undefined);
    await runDue(new Date(due.getTime() + 5 * 60_000), { config, deps: replay.deps, log: plainLog });
    expect(post).toHaveBeenCalledTimes(1);
    expect(replay.snapshot()[0]).toMatchObject({ status: "pending", publishAttemptedAt: expect.any(String) });
  });
});
