import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAutomationPaused } from "@/lib/automations/store";
import { HOLD_EVERYTHING, threadsAwaitingApproval } from "@/lib/publisher/approval";
import { resetReviewPolicyCache, writeReviewPolicy } from "@/lib/publisher/approvalStore";
import { ThreadsPublishPausedError } from "@/lib/threads/api";
import { threadsConfig, type ThreadsConfig } from "@/lib/threads/config";
import { runDue, type ThreadsRunDeps } from "@/lib/threads/runner";
import type { ThreadsQueueItem } from "@/lib/threads/types";
import { readQueue, writeQueue } from "@/lib/threads/queue";

const live = vi.hoisted(() => ({ holdBeforeClaim: false, post: vi.fn() }));
vi.mock("@/lib/automations/store", () => ({ isAutomationPaused: vi.fn(async () => false) }));
vi.mock("@/lib/automations/history", () => ({ recordAutomationEventSafely: vi.fn(async () => {}) }));
vi.mock("@/lib/threads/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/threads/api")>(), postToThreads: live.post
}));
vi.mock("@/lib/threads/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/threads/queue")>();
  return { ...actual, mutateQueue: async <T>(change: Parameters<typeof actual.mutateQueue<T>>[0]) => {
    if (live.holdBeforeClaim) {
      live.holdBeforeClaim = false;
      await writeReviewPolicy({ threads: "hold" });
    }
    return actual.mutateQueue(change);
  } };
});
const NOW = new Date("2026-07-22T07:16:00.000Z");
const row = (overrides: Partial<ThreadsQueueItem> = {}): ThreadsQueueItem => ({
  id: "race", batchDate: "2026-07-22", slot: 1, accountId: "primary", version: "text", topic: "verification",
  format: "insight", text: "fixture post", publishAt: "2026-07-22T07:15:00.000Z", status: "pending", attempts: 0,
  createdAt: "2026-07-22T06:00:00.000Z", ...overrides
});
const config = (): ThreadsConfig => ({
  ...threadsConfig(), enabled: true, timezone: "UTC", plugReplies: false,
  accounts: [{ id: "primary", label: "Fixture", userId: "1", accessToken: "fixture-token", posts: "text", offsetMinutes: 0 }]
});
const hold = () => writeReviewPolicy({ threads: "hold" });

beforeEach(async () => {
  live.holdBeforeClaim = false;
  live.post.mockReset();
  vi.mocked(isAutomationPaused).mockReset().mockResolvedValue(false);
  resetReviewPolicyCache();
  await writeReviewPolicy({ threads: "auto" });
});

function fixture(original = row()) {
  const state = { items: [structuredClone(original)] };
  const post = vi.fn<ThreadsRunDeps["post"]>(async () => ({ containerId: "container-fixture", postId: "post-fixture" }));
  const deps: ThreadsRunDeps = {
    read: async () => structuredClone(state.items),
    write: async (items) => { state.items = structuredClone(items); },
    post
  };
  return { state, deps, post };
}

describe("Threads approval policy stays current through claim and dispatch", () => {
  it("holds an unsent row when Hold is enabled while the queue read waits", async () => {
    const { state, deps, post } = fixture();
    const before = structuredClone(state.items);
    deps.read = async () => { await hold(); return structuredClone(state.items); };
    const report = await runDue(NOW, { config: config(), deps, log: () => {} });
    expect(post).not.toHaveBeenCalled();
    expect(state.items).toEqual(before);
    expect(report.heldForApproval).toBe(1);
  });

  it("refuses a fresh locked claim after Hold is enabled and never falls through to the fallback claim", async () => {
    const { state, deps, post } = fixture();
    const before = structuredClone(state.items);
    deps.claim = async (_id, prepare) => {
      await hold();
      const fresh = structuredClone(state.items[0]);
      if (prepare(fresh)) state.items = [fresh];
      return fresh;
    };
    const report = await runDue(NOW, { config: config(), deps, log: () => {} });
    expect(post).not.toHaveBeenCalled();
    expect(state.items).toEqual(before);
    expect(report.heldForApproval).toBe(1);
  });

  it("clears its own claim without spending an attempt if Hold arrives before dispatch", async () => {
    const { state, deps, post } = fixture();
    const before = structuredClone(state.items);
    deps.claim = async (_id, prepare) => {
      const fresh = structuredClone(state.items[0]);
      if (prepare(fresh)) state.items = [fresh];
      await hold();
      return fresh;
    };
    const report = await runDue(NOW, { config: config(), deps, log: () => {} });
    expect(post).not.toHaveBeenCalled();
    expect(state.items).toEqual(before);
    expect(report.heldForApproval).toBe(1);
  });

  it("checks policy after an asynchronous control wait inside the adapter callback", async () => {
    const { state, deps, post } = fixture();
    let checkingAdapter = false;
    vi.mocked(isAutomationPaused).mockImplementation(async () => {
      if (checkingAdapter) { checkingAdapter = false; await hold(); }
      return false;
    });
    let dispatched = 0;
    post.mockImplementation(async (input) => {
      checkingAdapter = true;
      if (!await input.shouldPublish?.()) throw new ThreadsPublishPausedError();
      dispatched += 1;
      return { containerId: "container-fixture", postId: "post-fixture" };
    });
    const report = await runDue(NOW, { config: config(), deps, log: () => {} });
    expect(dispatched).toBe(0);
    expect(state.items[0]).toMatchObject({ status: "pending", attempts: 0 });
    expect(state.items[0].claimedAt).toBeUndefined();
    expect(report.published + report.failed).toBe(0);
    expect(report.heldForApproval).toBe(1);
  });

  it("keeps a prior attempted retry released rather than treating it as an unsent row", async () => {
    const attempted = row({ attempts: 1, lastFailedAt: "2026-07-22T07:15:00.000Z" });
    expect(threadsAwaitingApproval(attempted, HOLD_EVERYTHING)).toBe(false);
  });

  it("does not mistake a legacy row without an attempt count for a delivery already started", () => {
    expect(threadsAwaitingApproval(row({ attempts: undefined }), HOLD_EVERYTHING)).toBe(true);
  });

  it.each([
    { approvedAt: "2026-07-22T07:00:00.000Z" },
    { attempts: 1, lastFailedAt: "2026-07-22T07:15:00.000Z" },
    { containerId: "persisted-container", containerPreparedAt: "2026-07-22T07:00:00.000Z" }
  ])("preserves existing approval or delivery evidence through a policy change: %j", async (evidence) => {
    const { state, deps, post } = fixture(row(evidence));
    deps.read = async () => { await hold(); return structuredClone(state.items); };
    const report = await runDue(NOW, { config: config(), deps, log: () => {} });
    expect(post).toHaveBeenCalledTimes(1);
    expect(report.published).toBe(1);
    if (evidence.containerId) expect(post).toHaveBeenCalledWith(expect.objectContaining({ containerId: evidence.containerId }));
    if (evidence.approvedAt) expect(state.items[0].approvedAt).toBe(evidence.approvedAt);
  });

  it("leaves a held row's reply copy unchanged too", async () => {
    const { state, deps, post } = fixture();
    const before = structuredClone(state.items);
    await hold();
    await runDue(NOW, { config: { ...config(), plugReplies: true }, deps, log: () => {} });
    expect(post).not.toHaveBeenCalled();
    expect(state.items).toEqual(before);
  });

  it("keeps the missed-slot rule and uses the current hold reason", async () => {
    const { state, deps, post } = fixture();
    deps.read = async () => { await hold(); return structuredClone(state.items); };
    const report = await runDue(new Date("2026-07-22T09:00:00.000Z"), { config: config(), deps, log: () => {} });
    expect(post).not.toHaveBeenCalled();
    expect(report.skipped).toBe(1);
    expect(state.items[0].note).toContain("Not approved before its slot");
  });

  it("refuses the default file-backed claim when Hold arrives before the locked row is prepared", async () => {
    const original = row();
    await writeQueue([original]);
    live.holdBeforeClaim = true;
    const report = await runDue(NOW, { config: config(), log: () => {} });
    expect(live.post).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([original]);
    expect(report.heldForApproval).toBe(1);
  });
});
