import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_REVIEW_POLICY,
  REVIEW_CHANNELS,
  legAwaitingApproval,
  normalizeReviewPolicy,
  policyHolds,
  threadsAwaitingApproval
} from "@/lib/publisher/approval";
import { readReviewPolicy, reviewPolicyPath, writeReviewPolicy } from "@/lib/publisher/approvalStore";
import type { PlatformState } from "@/lib/publisher/types";
import type { ThreadsQueueItem } from "@/lib/threads/types";

const leg = (overrides: Partial<PlatformState> = {}): PlatformState => ({ status: "pending", attempts: 0, ...overrides });

const threadsItem = (overrides: Partial<ThreadsQueueItem> = {}): ThreadsQueueItem => ({
  id: "t1",
  batchDate: "2026-07-22",
  slot: 1,
  accountId: "primary",
  version: "text",
  topic: "topic",
  format: "insight",
  text: "the post",
  publishAt: "2026-07-22T07:15:00.000Z",
  status: "pending",
  attempts: 0,
  createdAt: "2026-07-22T06:00:00.000Z",
  ...overrides
});

const holdAll = normalizeReviewPolicy(Object.fromEntries(REVIEW_CHANNELS.map((channel) => [channel, "hold"])));

describe("review policy", () => {
  it("is auto on every channel by default", () => {
    expect(REVIEW_CHANNELS).toEqual(["youtube", "instagram", "tiktok", "facebook", "threads"]);
    expect(Object.values(DEFAULT_REVIEW_POLICY)).toEqual(["auto", "auto", "auto", "auto", "auto"]);
    expect(policyHolds(DEFAULT_REVIEW_POLICY)).toBe(false);
  });

  it("falls back to auto for anything it does not recognise", () => {
    expect(normalizeReviewPolicy(undefined)).toEqual(DEFAULT_REVIEW_POLICY);
    expect(normalizeReviewPolicy("hold")).toEqual(DEFAULT_REVIEW_POLICY);
    expect(normalizeReviewPolicy({ youtube: "maybe", bluesky: "hold", instagram: 3 })).toEqual(DEFAULT_REVIEW_POLICY);
  });

  it("keeps the channels it is told to hold", () => {
    const policy = normalizeReviewPolicy({ instagram: "hold", threads: "hold", tiktok: "auto" });
    expect(policy).toEqual({ ...DEFAULT_REVIEW_POLICY, instagram: "hold", threads: "hold" });
    expect(policyHolds(policy)).toBe(true);
  });
});

describe("what is awaiting approval", () => {
  it("never holds anything while the channel is on auto", () => {
    expect(legAwaitingApproval(leg(), "instagram", DEFAULT_REVIEW_POLICY)).toBe(false);
    expect(threadsAwaitingApproval(threadsItem(), DEFAULT_REVIEW_POLICY)).toBe(false);
  });

  it("holds a leg nothing has been sent for", () => {
    expect(legAwaitingApproval(leg(), "instagram", holdAll)).toBe(true);
    expect(threadsAwaitingApproval(threadsItem(), holdAll)).toBe(true);
  });

  it("holds only the channel set to hold", () => {
    const policy = normalizeReviewPolicy({ tiktok: "hold" });
    expect(legAwaitingApproval(leg(), "tiktok", policy)).toBe(true);
    expect(legAwaitingApproval(leg(), "instagram", policy)).toBe(false);
    expect(threadsAwaitingApproval(threadsItem(), policy)).toBe(false);
  });

  it("releases a leg once it is approved", () => {
    expect(legAwaitingApproval(leg({ approvedAt: "2026-07-10T12:00:00.000Z" }), "instagram", holdAll)).toBe(false);
    expect(threadsAwaitingApproval(threadsItem({ approvedAt: "2026-07-22T06:30:00.000Z" }), holdAll)).toBe(false);
  });

  it("never holds a post that is already on the platform or has started sending", () => {
    for (const started of [
      leg({ status: "scheduled", postId: "vid1" }),
      leg({ status: "uploaded", containerId: "c1" }),
      leg({ postId: "p1" }),
      leg({ containerId: "c1" }),
      leg({ uploadedAt: "2026-07-10T12:00:00.000Z" }),
      leg({ claimedAt: "2026-07-10T12:00:00.000Z" }),
      leg({ attempts: 1, nextAttemptAt: "2026-07-10T12:05:00.000Z" }),
      leg({ status: "published", postId: "p1" }),
      leg({ status: "failed" }),
      leg({ status: "manual" })
    ]) {
      expect(legAwaitingApproval(started, "youtube", holdAll)).toBe(false);
    }
    for (const started of [
      threadsItem({ status: "published", postId: "p" }),
      threadsItem({ containerId: "c" }),
      threadsItem({ claimedAt: "2026-07-22T07:15:00.000Z" }),
      threadsItem({ status: "skipped" }),
      threadsItem({ status: "failed" })
    ]) {
      expect(threadsAwaitingApproval(started, holdAll)).toBe(false);
    }
  });
});

describe("the saved policy", () => {
  beforeEach(async () => {
    await mkdir(path.dirname(reviewPolicyPath()), { recursive: true });
    await rm(reviewPolicyPath(), { force: true });
  });
  afterEach(async () => {
    await rm(reviewPolicyPath(), { force: true });
  });

  it("is all auto when nothing has been saved", () => {
    expect(readReviewPolicy()).toEqual(DEFAULT_REVIEW_POLICY);
  });

  it("is all auto when the file is not valid", async () => {
    await writeFile(reviewPolicyPath(), "{ not json", "utf8");
    expect(readReviewPolicy()).toEqual(DEFAULT_REVIEW_POLICY);
  });

  it("is written to data/review-policy.json and read back", async () => {
    const saved = await writeReviewPolicy({ instagram: "hold" });
    expect(saved).toEqual({ ...DEFAULT_REVIEW_POLICY, instagram: "hold" });
    expect(JSON.parse(await readFile(reviewPolicyPath(), "utf8"))).toEqual(saved);
    expect(readReviewPolicy()).toEqual(saved);
  });

  it("changes only the channels it is given", async () => {
    await writeReviewPolicy({ instagram: "hold", threads: "hold" });
    const saved = await writeReviewPolicy({ instagram: "auto" });
    expect(saved).toEqual({ ...DEFAULT_REVIEW_POLICY, threads: "hold" });
  });

  it("picks up a file changed behind its back", async () => {
    await writeReviewPolicy({ tiktok: "hold" });
    expect(readReviewPolicy().tiktok).toBe("hold");
    await writeFile(reviewPolicyPath(), JSON.stringify({ facebook: "hold" }), "utf8");
    expect(readReviewPolicy()).toEqual({ ...DEFAULT_REVIEW_POLICY, facebook: "hold" });
  });
});
