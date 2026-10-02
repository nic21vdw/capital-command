import { describe, expect, it, vi } from "vitest";
import { threadsConfig, type ThreadsConfig } from "@/lib/threads/config";
import type { ThreadsQueueItem } from "@/lib/threads/types";
import { countThreadsReplies, previewThreadsReply, safeThreadsDetail, summarizeThreadsReplies, threadsReplyPolicy } from "@/lib/threads/reply-summary";

const generate = vi.hoisted(() => vi.fn((text: string, seed: string, config: ThreadsConfig, origin?: "autopilot" | "pipeline") =>
  text.includes("private") ? undefined : `${origin ?? "autopilot"}: ${text} (${seed}) ${config.plugUrl}`
));
vi.mock("@/lib/threads/plug", () => ({ plugReplyFor: generate }));

const now = new Date("2026-10-02T15:20:00.000Z");
const config = (): ThreadsConfig => ({
  ...threadsConfig(),
  accounts: [{ id: "primary", label: "Nic", accessToken: "test-private-token", userId: "123", posts: "text", offsetMinutes: 0 }]
});
const item = (overrides: Partial<ThreadsQueueItem> & { plugClaimedAt?: string; plugNextAttemptAt?: string; plugSourceText?: string } = {}): ThreadsQueueItem => ({
  id: "post-1", accountId: "primary", batchDate: "2026-10-02", slot: 1, version: "text", topic: "Build tools", format: "story",
  text: "I built a tool in CoLateral.", publishAt: "2026-10-02T15:00:00.000Z", createdAt: "2026-10-02T14:00:00.000Z", attempts: 0,
  status: "published", postId: "threads-1", publishedAt: "2026-10-02T15:10:00.000Z", ...overrides
});

describe("Threads follow-up reply previews", () => {
  it("previews legacy queue entries without changing the queue or claiming delivery", () => {
    const queued = item({ plugText: undefined });
    const before = structuredClone(queued);
    const preview = previewThreadsReply(queued, config(), now);
    expect(preview).toMatchObject({ itemId: "post-1", status: "pending", nextAttemptAt: "2026-10-02T15:12:00.000Z", expiresAt: "2026-10-02T21:10:00.000Z" });
    expect(preview?.text).toContain(queued.text);
    expect(queued).toEqual(before);
  });

  it("regenerates unsent copy after an edit and passes pipeline origin to the generator", () => {
    const queued = item({ status: "pending", plugText: "Old reply", plugSourceText: "Old parent", text: "Updated build", origin: "pipeline" });
    const preview = previewThreadsReply(queued, config(), now);
    expect(preview).toMatchObject({ status: "pending", detail: "Waiting for the original post to publish." });
    expect(preview?.text).toContain("pipeline: Updated build");
    expect(preview?.nextAttemptAt).toBeUndefined();
  });

  it.each([
    { plugAttempts: 1 }, { plugContainerId: "container-1" }, { plugClaimedAt: now.toISOString() }
  ])("keeps the exact reply copy once delivery has started: %j", (started) => {
    expect(previewThreadsReply(item({ ...started, plugText: "Frozen reply", text: "Changed parent" }), config(), now)?.text).toBe("Frozen reply");
  });

  it.each([
    [{ plugAttempts: 1 }, "disabled"],
    [{ plugContainerId: "container-1" }, "disabled"],
    [{ plugClaimedAt: now.toISOString() }, "disabled"],
    [{ plugPostId: "reply-1" }, "delivered"],
    [{ plugDropped: true }, "dropped"]
  ] as Array<[Partial<ThreadsQueueItem> & { plugClaimedAt?: string }, string]>)("does not invent replacement copy for a started reply whose saved text is missing", (history, status) => {
    const preview = previewThreadsReply(item({ ...history, publishedAt: "2026-10-02T08:00:00.000Z" }), config(), now);
    expect(preview).toMatchObject({ status, text: "" });
    expect(preview?.detail).toMatch(/saved copy|saved reply copy/);
  });

  it("shows confirmed deliveries while the reply switch or automation is disabled", () => {
    expect(previewThreadsReply(item({ plugPostId: "reply-1", plugText: "Published reply", plugError: "stale error" }), { ...config(), enabled: false, plugReplies: false }, now, true))
      .toMatchObject({ status: "delivered", text: "Published reply", error: undefined });
  });

  it.each([
    [{ enabled: false }, false, "Threads automation is switched off."],
    [{ plugReplies: false }, false, "Follow-up replies are switched off."],
    [{}, true, "Threads automation is paused."],
    [{ accounts: [] }, false, "Connect a Threads account to send follow-up replies."]
  ] as Array<[Partial<ThreadsConfig>, boolean, string]>)("reports disabled rather than ready when runtime is blocked", (overrides, paused, detail) => {
    const preview = previewThreadsReply(item(), { ...config(), ...overrides }, now, paused);
    expect(preview).toMatchObject({ status: "disabled", detail });
    expect(preview?.text).toContain("colateralai.com");
  });

  it("reports a disconnected per-post account", () => {
    expect(previewThreadsReply(item({ accountId: "removed" }), config(), now)).toMatchObject({ status: "disabled", detail: "This post's Threads account is no longer connected." });
  });

  it("reports retry backoff and safely redacts the useful error", () => {
    const preview = previewThreadsReply(item({ plugText: "Frozen", plugAttempts: 1, plugNextAttemptAt: "2026-10-02T15:30:00.000Z", plugError: "HTTP 429 with test-private-token" }), config(), now);
    expect(preview).toMatchObject({ status: "retrying", nextAttemptAt: "2026-10-02T15:30:00.000Z", error: "HTTP 429 with [hidden]" });
  });

  it("does not call an in-flight claim delivered", () => {
    expect(previewThreadsReply(item({ plugText: "Claimed", plugClaimedAt: now.toISOString() }), config(), now))
      .toMatchObject({ status: "pending", detail: "Sending reply; waiting for delivery confirmation." });
  });

  it.each([
    [item({ plugDropped: true, plugText: "Old reply", plugError: "HTTP 400" }), "HTTP 400"],
    [item({ publishedAt: "2026-10-02T08:00:00.000Z", plugText: "Planned reply" }), "The reply window expired before delivery."],
    [item({ plugAttempts: 4, plugText: "Attempted" }), "The reply reached its retry limit."],
    [item({ publishedAt: "bad date", plugText: "Planned reply" }), "The original post's publish time is unavailable; the reply cannot be timed safely."]
  ])("explains replies that cannot be delivered", (queued, detail) => {
    expect(previewThreadsReply(queued, config(), now)).toMatchObject({ status: "dropped", detail });
  });

  it("does not invent a delivery when the parent id is missing", () => {
    expect(previewThreadsReply(item({ postId: undefined }), config(), now)?.status).toBe("disabled");
  });

  it("ignores failed/skipped parents and content excluded by the generator", () => {
    for (const queued of [item({ status: "failed" }), item({ status: "skipped" }), item({ text: "private content" })]) {
      expect(previewThreadsReply(queued, config(), now)).toBeUndefined();
    }
  });

  it("does not manufacture dropped replies for old history that never had a planned reply", () => {
    expect(previewThreadsReply(item({ publishedAt: "2026-10-02T08:00:00.000Z" }), config(), now)).toBeUndefined();
    expect(previewThreadsReply(item({ publishedAt: undefined }), config(), now)).toBeUndefined();
  });

  it("handles invalid backoff and abandoned claim timestamps without throwing", () => {
    expect(previewThreadsReply(item({ plugText: "Saved reply", plugNextAttemptAt: "bad date", plugClaimedAt: "bad date" }), config(), now))
      .toMatchObject({ status: "pending", nextAttemptAt: "2026-10-02T15:12:00.000Z" });
  });

  it("counts only the selected batch's eligible follow-up replies", () => {
    const summary = summarizeThreadsReplies([
      item(), item({ id: "delivered", plugPostId: "reply", plugText: "Done" }), item({ id: "retry", plugAttempts: 1, plugText: "Again" }),
      item({ id: "dropped", plugDropped: true, plugText: "Stopped" }), item({ id: "disabled", accountId: "removed" }),
      item({ id: "yesterday", batchDate: "2026-10-01", plugPostId: "other", plugText: "Other day" }), item({ id: "failed", status: "failed" })
    ], "2026-10-02", config(), now);
    expect(summary.today).toEqual({ total: 5, delivered: 1, pending: 1, retrying: 1, dropped: 1, disabled: 1 });
    expect(summary.items).toHaveLength(6);
    expect(countThreadsReplies([])).toEqual({ total: 0, delivered: 0, pending: 0, retrying: 0, dropped: 0, disabled: 0 });
  });
});

describe("safe reply policy", () => {
  it("exposes only the effective switch, timing and safe destination", () => {
    expect(threadsReplyPolicy(config())).toEqual({ enabled: true, delayMinutes: 2, windowMinutes: 360, url: "https://colateralai.com", disabledReason: null });
    expect(JSON.stringify(threadsReplyPolicy(config()))).not.toContain("test-private-token");
  });

  it.each(["javascript:alert(1)", "not a url", "https://secret:password@colateralai.com", "https://colateralai.com?access_token=secret", "https://colateralai.com/\n", `https://colateralai.com/${"a".repeat(330)}`])("does not expose an unsafe destination: %s", (plugUrl) => {
    expect(threadsReplyPolicy({ ...config(), plugUrl })).toMatchObject({ enabled: false, url: null });
  });

  it("redacts credentials in common provider error formats", () => {
    expect(safeThreadsDetail('Failed Bearer SECRET; https://host?access_token=MORE and {"client_secret":"PRIVATE"}', config()))
      .toBe('Failed Bearer [hidden]; https://host?access_token=[hidden] and {"client_secret":"[hidden]"}');
  });
});
