import { describe, expect, it, vi } from "vitest";
import { PermanentError } from "@/lib/publisher/http";
import { ContainerPendingError } from "@/lib/threads/api";
import { threadsConfig, type ThreadsAccount, type ThreadsConfig } from "@/lib/threads/config";
import { runDue, type ThreadsRunDeps } from "@/lib/threads/runner";
import type { ThreadsQueueItem } from "@/lib/threads/types";

function account(overrides: Partial<ThreadsAccount> = {}): ThreadsAccount {
  return {
    id: "primary",
    label: "primary",
    userId: "1",
    accessToken: "token",
    posts: "text",
    offsetMinutes: 0,
    ...overrides
  };
}

function config(overrides: Partial<ThreadsConfig> = {}): ThreadsConfig {
  return {
    ...threadsConfig(),
    timezone: "UTC",
    accounts: [account(), account({ id: "secondary", label: "secondary", userId: "2", posts: "variant" })],
    ...overrides
  };
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

/** A queue held in memory, so the runner never touches the filesystem. */
function deps(items: ThreadsQueueItem[], post?: ThreadsRunDeps["post"]) {
  const state = { items };
  const posted: Array<{ accountId: string; text: string }> = [];
  const runDeps: ThreadsRunDeps = {
    read: async () => state.items,
    write: async (next) => {
      state.items = next;
    },
    post:
      post ??
      (async (input) => {
        posted.push({ accountId: input.account.id, text: input.text });
        return { containerId: "container-1", postId: `post-${posted.length}` };
      })
  };
  return { runDeps, state, posted };
}

const silent = () => {};

describe("runDue", () => {
  it("posts an item once its time has come, as its own account", async () => {
    const { runDeps, state, posted } = deps([item()]);

    const report = await runDue(new Date("2026-07-22T07:16:00.000Z"), { config: config(), deps: runDeps, log: silent });

    expect(report.published).toBe(1);
    expect(posted).toEqual([{ accountId: "primary", text: "the post" }]);
    expect(state.items[0]).toMatchObject({ status: "published", postId: "post-1" });
  });

  it("posts each account's own version of a slot", async () => {
    const { runDeps, posted } = deps([
      item({ id: "a", accountId: "primary", text: "punchy" }),
      item({ id: "b", accountId: "secondary", version: "variant", text: "warm", publishAt: "2026-07-22T07:18:00.000Z" })
    ]);

    await runDue(new Date("2026-07-22T07:20:00.000Z"), { config: config(), deps: runDeps, log: silent });

    expect(posted).toEqual([
      { accountId: "primary", text: "punchy" },
      { accountId: "secondary", text: "warm" }
    ]);
  });

  it("keeps one account's failure off the other", async () => {
    const post = vi.fn(async (input: { account: ThreadsAccount; text: string }) => {
      if (input.account.id === "primary") throw new PermanentError("bad token");
      return { containerId: "c", postId: "post-ok" };
    });
    const { runDeps, state } = deps(
      [item({ id: "a", accountId: "primary" }), item({ id: "b", accountId: "secondary", version: "variant" })],
      post
    );

    const report = await runDue(new Date("2026-07-22T07:16:00.000Z"), { config: config(), deps: runDeps, log: silent });

    expect(report.failed).toBe(1);
    expect(report.published).toBe(1);
    expect(state.items.find((entry) => entry.id === "a")?.status).toBe("failed");
    expect(state.items.find((entry) => entry.id === "b")?.status).toBe("published");
  });

  it("leaves an item that is not due yet alone", async () => {
    const { runDeps, posted } = deps([item()]);

    const report = await runDue(new Date("2026-07-22T07:00:00.000Z"), { config: config(), deps: runDeps, log: silent });

    expect(posted).toHaveLength(0);
    expect(report.outcomes).toHaveLength(0);
  });

  it("never re-posts something already published", async () => {
    const { runDeps, posted } = deps([item({ status: "published", postId: "post-1" })]);

    await runDue(new Date("2026-07-22T09:00:00.000Z"), { config: config(), deps: runDeps, log: silent });

    expect(posted).toHaveLength(0);
  });

  it("skips a post that missed its slot instead of firing it late", async () => {
    const { runDeps, state, posted } = deps([item()]);

    const report = await runDue(new Date("2026-07-22T12:00:00.000Z"), {
      config: config({ lateGraceMinutes: 45 }),
      deps: runDeps,
      log: silent
    });

    expect(posted).toHaveLength(0);
    expect(report.skipped).toBe(1);
    expect(state.items[0].status).toBe("skipped");
    expect(state.items[0].note).toContain("Missed its");
  });

  it("still posts inside the grace window", async () => {
    const { runDeps, posted } = deps([item()]);

    await runDue(new Date("2026-07-22T07:50:00.000Z"), {
      config: config({ lateGraceMinutes: 45 }),
      deps: runDeps,
      log: silent
    });

    expect(posted).toHaveLength(1);
  });

  it("skips a post whose account is no longer connected", async () => {
    const { runDeps, state, posted } = deps([item({ accountId: "secondary" })]);

    await runDue(new Date("2026-07-22T07:16:00.000Z"), {
      config: config({ accounts: [account()] }),
      deps: runDeps,
      log: silent
    });

    expect(posted).toHaveLength(0);
    expect(state.items[0].status).toBe("skipped");
    expect(state.items[0].note).toContain("no longer connected");
  });

  it("backs off and retries a transient failure", async () => {
    const post = vi.fn(async () => {
      throw new ContainerPendingError("container-9", "not ready");
    });
    const { runDeps, state } = deps([item()], post);

    const report = await runDue(new Date("2026-07-22T07:16:00.000Z"), {
      config: config({ maxAttempts: 3, backoffBaseMinutes: 5 }),
      deps: runDeps,
      log: silent
    });

    expect(report.outcomes[0].outcome).toBe("retrying");
    expect(state.items[0]).toMatchObject({ status: "pending", attempts: 1, containerId: "container-9" });
    expect(state.items[0].nextAttemptAt).toBe("2026-07-22T07:21:00.000Z");
  });

  it("re-uses the container from a failed attempt instead of creating a second one", async () => {
    const post = vi.fn(async () => ({ containerId: "container-9", postId: "post-1" }));
    const { runDeps } = deps([item({ containerId: "container-9", attempts: 1 })], post);

    await runDue(new Date("2026-07-22T07:16:00.000Z"), { config: config(), deps: runDeps, log: silent });

    expect(post).toHaveBeenCalledWith(expect.objectContaining({ containerId: "container-9" }));
  });

  it("fails an item permanently when the platform rejects it", async () => {
    const post = vi.fn(async () => {
      throw new PermanentError("text too long");
    });
    const { runDeps, state } = deps([item()], post);

    const report = await runDue(new Date("2026-07-22T07:16:00.000Z"), { config: config(), deps: runDeps, log: silent });

    expect(report.failed).toBe(1);
    expect(state.items[0]).toMatchObject({ status: "failed", error: "text too long" });
  });

  it("gives up after the attempt limit", async () => {
    const post = vi.fn(async () => {
      throw new ContainerPendingError("container-9", "still not ready");
    });
    const { runDeps, state } = deps([item({ attempts: 2 })], post);

    await runDue(new Date("2026-07-22T07:16:00.000Z"), {
      config: config({ maxAttempts: 3 }),
      deps: runDeps,
      log: silent
    });

    expect(state.items[0].status).toBe("failed");
  });

  it("reports what it would do without posting on a dry run", async () => {
    const { runDeps, state, posted } = deps([item()]);

    const report = await runDue(new Date("2026-07-22T07:16:00.000Z"), {
      config: config(),
      deps: runDeps,
      dryRun: true,
      log: silent
    });

    expect(posted).toHaveLength(0);
    expect(report.dryRun).toBe(true);
    expect(report.published).toBe(1);
    expect(state.items[0].status).toBe("pending");
  });

  it("does nothing at all when no account is connected", async () => {
    const { runDeps, posted } = deps([item()]);

    const report = await runDue(new Date("2026-07-22T07:16:00.000Z"), {
      config: config({ accounts: [] }),
      deps: runDeps,
      log: silent
    });

    expect(posted).toHaveLength(0);
    expect(report.note).toContain("No Threads account is connected");
  });

  it("respects a live claim from an overlapping run", async () => {
    const { runDeps, posted } = deps([item({ claimedAt: "2026-07-22T07:15:30.000Z" })]);

    await runDue(new Date("2026-07-22T07:16:00.000Z"), {
      config: config({ claimTimeoutMinutes: 10 }),
      deps: runDeps,
      log: silent
    });

    expect(posted).toHaveLength(0);
  });
});
