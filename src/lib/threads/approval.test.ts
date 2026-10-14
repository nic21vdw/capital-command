import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAutomationPaused } from "@/lib/automations/store";
import { reviewPolicyPath } from "@/lib/publisher/approvalStore";
import { planAddedPost } from "@/lib/threads/addPost";
import { threadsConfig, type ThreadsAccount, type ThreadsConfig } from "@/lib/threads/config";
import { approveItems, retryItem } from "@/lib/threads/queue";
import { runDue, type ThreadsRunDeps } from "@/lib/threads/runner";
import type { ThreadsQueueItem } from "@/lib/threads/types";

vi.mock("@/lib/automations/store", () => ({ isAutomationPaused: vi.fn(async () => false) }));
vi.mock("@/lib/automations/history", () => ({ recordAutomationEventSafely: vi.fn(async () => {}) }));

async function setPolicy(policy: Record<string, string>) {
  await mkdir(path.dirname(reviewPolicyPath()), { recursive: true });
  await writeFile(reviewPolicyPath(), JSON.stringify(policy), "utf8");
}

beforeEach(async () => {
  await rm(reviewPolicyPath(), { force: true });
});

afterEach(async () => {
  vi.mocked(isAutomationPaused).mockResolvedValue(false);
  await rm(reviewPolicyPath(), { force: true });
});

function account(overrides: Partial<ThreadsAccount> = {}): ThreadsAccount {
  return { id: "primary", label: "primary", userId: "1", accessToken: "token", posts: "text", offsetMinutes: 0, ...overrides };
}

function config(overrides: Partial<ThreadsConfig> = {}): ThreadsConfig {
  return { ...threadsConfig(), timezone: "UTC", plugReplies: false, accounts: [account()], ...overrides };
}

function item(overrides: Partial<ThreadsQueueItem> = {}): ThreadsQueueItem {
  return {
    id: "item-1",
    batchDate: "2026-07-22",
    slot: 1,
    accountId: "primary",
    version: "text",
    topic: "verification",
    format: "insight",
    text: "the post",
    publishAt: "2026-07-22T07:15:00.000Z",
    status: "pending",
    attempts: 0,
    createdAt: "2026-07-22T06:00:00.000Z",
    ...overrides
  };
}

function deps(items: ThreadsQueueItem[]) {
  const state = { items };
  const posted: string[] = [];
  const runDeps: ThreadsRunDeps = {
    read: async () => state.items,
    write: async (next) => {
      state.items = next;
    },
    post: async (input) => {
      posted.push(input.text);
      return { containerId: "container-1", postId: `post-${posted.length}` };
    }
  };
  return { runDeps, state, posted };
}

const silent = () => {};
const AT = new Date("2026-07-22T07:16:00.000Z");

describe("the Threads autopilot with the policy on auto", () => {
  it("posts exactly as it did before, with or without a saved policy", async () => {
    for (const saved of [false, true]) {
      if (saved) await setPolicy({ threads: "auto", youtube: "hold" });
      const { runDeps, state, posted } = deps([item()]);
      const report = await runDue(AT, { config: config(), deps: runDeps, log: silent });
      expect(report.published).toBe(1);
      expect(posted).toEqual(["the post"]);
      expect(state.items[0]).toMatchObject({ status: "published", postId: "post-1" });
      expect(state.items[0].approvedAt).toBeUndefined();
    }
  });
});

describe("the Threads autopilot with Threads set to hold", () => {
  beforeEach(async () => {
    await setPolicy({ threads: "hold" });
  });

  it("leaves an unapproved post exactly as it found it", async () => {
    const original = item();
    const { runDeps, state, posted } = deps([structuredClone(original)]);

    for (let run = 0; run < 3; run += 1) {
      const report = await runDue(AT, { config: config(), deps: runDeps, log: silent });
      expect(report.published + report.failed + report.skipped).toBe(0);
    }

    expect(posted).toEqual([]);
    expect(state.items[0]).toEqual(original);
  });

  it("posts it on the next tick once it is approved", async () => {
    const { runDeps, state, posted } = deps([item()]);
    await runDue(AT, { config: config(), deps: runDeps, log: silent });
    expect(posted).toEqual([]);

    const approved = approveItems(state.items, { id: "item-1" }, AT);
    expect(approved.changed).toBe(1);
    expect(state.items[0].approvedAt).toBe(AT.toISOString());

    const report = await runDue(AT, { config: config(), deps: runDeps, log: silent });
    expect(report.published).toBe(1);
    expect(posted).toEqual(["the post"]);
    expect(state.items[0]).toMatchObject({ status: "published", approvedAt: AT.toISOString() });
  });

  it("plans the link reply of an approved post as usual", async () => {
    const { runDeps, state } = deps([item({ approvedAt: "2026-07-22T07:00:00.000Z" })]);
    await runDue(AT, { config: config({ plugReplies: true, plugDelayMinutes: 0 }), deps: runDeps, log: silent });
    expect(state.items[0].status).toBe("published");
    expect(state.items[0].plugText).toBeTruthy();
  });

  it("skips, never fires late, a post that was not approved before its slot ran out", async () => {
    const { runDeps, state, posted } = deps([item()]);
    const late = new Date("2026-07-22T09:00:00.000Z");

    const report = await runDue(late, { config: config(), deps: runDeps, log: silent });

    expect(posted).toEqual([]);
    expect(report.skipped).toBe(1);
    expect(state.items[0].status).toBe("skipped");
    expect(state.items[0].note).toContain("Not approved before its slot");
  });

  it("keeps the old missed-slot note for a post that was approved and still missed", async () => {
    const { runDeps, state } = deps([item({ approvedAt: "2026-07-22T06:30:00.000Z" })]);
    await runDue(new Date("2026-07-22T09:00:00.000Z"), { config: config(), deps: runDeps, log: silent });
    expect(state.items[0].status).toBe("skipped");
    expect(state.items[0].note).not.toContain("not approved");
    expect(state.items[0].note).toContain("Missed its");
  });

  it("holds a post a stream produced, but not one the person typed", () => {
    const now = new Date("2026-10-10T14:00:00.000Z");
    const added = planAddedPost({ text: "My own words", config: config({ postsPerDay: 6 }), now, taken: new Set(), newId: () => "added-1" });
    expect(added.ok && added.item.approvedAt).toBe(now.toISOString());
  });
});

describe("approving Threads posts", () => {
  const rows = () => [
    item({ id: "a" }),
    item({ id: "b", slot: 2 }),
    item({ id: "c", slot: 3, status: "published", postId: "p1" }),
    item({ id: "d", slot: 4, claimedAt: "2026-07-22T07:15:00.000Z" })
  ];

  it("approves one pending post", () => {
    const items = rows();
    expect(approveItems(items, { id: "a" }, AT).changed).toBe(1);
    expect(items.map((entry) => entry.approvedAt)).toEqual([AT.toISOString(), undefined, undefined, undefined]);
  });

  it("approves every post that is waiting, and nothing that has gone out", () => {
    const items = rows();
    const result = approveItems(items, {}, AT);
    expect(result.changed).toBe(2);
    expect(items.map((entry) => entry.approvedAt !== undefined)).toEqual([true, true, false, false]);
  });

  it("says so when there is nothing to approve", () => {
    expect(approveItems(rows(), { id: "c" }, AT)).toMatchObject({ changed: 0, error: expect.stringContaining("already") });
    expect(approveItems(rows(), { id: "missing" }, AT)).toMatchObject({ changed: 0, error: "No such queued post." });
  });

  it("counts a retry as the owner's approval", () => {
    const items = [item({ id: "x", status: "skipped", note: "Not approved before its slot" })];
    expect(retryItem(items, "x", AT).changed).toBe(1);
    expect(items[0]).toMatchObject({ status: "pending", approvedAt: AT.toISOString() });
  });

  it("never moves a post when it approves it", () => {
    const items = rows();
    const before = items.map((entry) => entry.publishAt);
    approveItems(items, {}, AT);
    expect(items.map((entry) => entry.publishAt)).toEqual(before);
  });
});
