import { afterEach, describe, expect, it, vi } from "vitest";
import { PermanentError } from "@/lib/publisher/http";
import { ContainerPendingError, ContainerRejectedError, ThreadsPublishPausedError } from "@/lib/threads/api";
import { isAutomationPaused } from "@/lib/automations/store";
import { plugReplyFor } from "@/lib/threads/plug";
import { threadsConfig, type ThreadsAccount, type ThreadsConfig } from "@/lib/threads/config";
import { runDue, type ThreadsRunDeps } from "@/lib/threads/runner";
import type { ThreadsQueueItem } from "@/lib/threads/types";

vi.mock("@/lib/automations/store", () => ({ isAutomationPaused: vi.fn(async () => false) }));
vi.mock("@/lib/automations/history", () => ({ recordAutomationEventSafely: vi.fn(async () => {}) }));
afterEach(() => {
  vi.mocked(isAutomationPaused).mockResolvedValue(false);
});

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
  it("does not send the same post twice when two runs read separate snapshots", async () => {
    let saved = [item()];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const post = vi.fn(async () => {
      await blocked;
      return { containerId: "container-one", postId: "post-one" };
    });
    const runDeps: ThreadsRunDeps = {
      read: async () => structuredClone(saved),
      write: async (next) => { saved = structuredClone(next); },
      post
    };
    const now = new Date("2026-07-22T07:16:00Z");
    const first = runDue(now, { config: config(), deps: runDeps, log: silent });
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const overlapping = await runDue(now, { config: config(), deps: runDeps, log: silent });
    expect(overlapping.note).toContain("already in progress");
    expect(post).toHaveBeenCalledTimes(1);
    release();
    await first;
    await runDue(now, { config: config(), deps: runDeps, log: silent });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("posts an item once its time has come, as its own account", async () => {
    const { runDeps, state, posted } = deps([item()]);

    const report = await runDue(new Date("2026-07-22T07:16:00.000Z"), { config: config(), deps: runDeps, log: silent });

    expect(report.published).toBe(1);
    expect(posted).toEqual([{ accountId: "primary", text: "the post" }]);
    expect(state.items[0]).toMatchObject({ status: "published", postId: "post-1" });
  });

  it("never posts a pending item that already carries a Threads post id", async () => {
    const { runDeps, state, posted } = deps([item({ postId: "post-1", error: "could not save the queue" })]);

    const report = await runDue(new Date("2026-07-22T07:16:00.000Z"), { config: config(), deps: runDeps, log: silent });

    expect(posted).toEqual([]);
    expect(report.published).toBe(1);
    expect(state.items[0]).toMatchObject({ status: "published", postId: "post-1" });
    expect(state.items[0].error).toBeUndefined();
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

describe("runDue link replies", () => {
  const plugged = (overrides: Partial<ThreadsQueueItem> = {}) =>
    item({
      status: "published",
      postId: "post-main",
      publishedAt: "2026-07-22T07:15:00.000Z",
      text: "CoLateral is where I build my own tools.",
      plugText: "what I'm building: https://colateralai.com",
      ...overrides
    });

  it("replies under a published CoLateral post with the link, once", async () => {
    const replies: Array<{ text: string; replyToId?: string }> = [];
    const { runDeps, state } = deps([plugged()], async (input) => {
      replies.push({ text: input.text, replyToId: input.replyToId });
      return { containerId: "c-reply", postId: "post-reply" };
    });

    await runDue(new Date("2026-07-22T07:20:00.000Z"), { config: config(), deps: runDeps, log: silent });
    await runDue(new Date("2026-07-22T07:25:00.000Z"), { config: config(), deps: runDeps, log: silent });

    expect(replies).toEqual([{ text: plugReplyFor(plugged().text, "item-1", config()), replyToId: "post-main" }]);
    expect(state.items[0]).toMatchObject({ status: "published", postId: "post-main", plugPostId: "post-reply" });
  });

  it("waits out the delay before replying", async () => {
    const { runDeps, posted } = deps([plugged()]);

    await runDue(new Date("2026-07-22T07:16:00.000Z"), { config: config(), deps: runDeps, log: silent });

    expect(posted).toEqual([]);
  });

  it("drops a reply that is far past its post instead of sending it late", async () => {
    const { runDeps, state, posted } = deps([plugged()]);

    await runDue(new Date("2026-07-22T20:00:00.000Z"), { config: config(), deps: runDeps, log: silent });

    expect(posted).toEqual([]);
    expect(state.items[0].plugDropped).toBe(true);
  });

  it("never touches the post itself when the reply fails", async () => {
    const { runDeps, state } = deps([plugged()], async () => {
      throw new PermanentError("links not allowed");
    });

    await runDue(new Date("2026-07-22T07:20:00.000Z"), { config: config(), deps: runDeps, log: silent });

    expect(state.items[0]).toMatchObject({ status: "published", postId: "post-main", plugDropped: true });
  });
});

describe("runDue reply delivery reliability", () => {
  const now = new Date("2026-07-22T07:20:00Z");
  const published = (overrides: Partial<ThreadsQueueItem> = {}) => item({
    status: "published", postId: "parent", publishedAt: "2026-07-22T07:15:00Z",
    text: "CoLateral is where I build my own tools.", ...overrides
  });

  it("honours the live reply switch even when old copy is already queued", async () => {
    const original = published({ plugText: "old reply" });
    const { runDeps, state, posted } = deps([original]);
    const report = await runDue(now, { config: config({ plugReplies: false }), deps: runDeps, log: silent });
    expect(posted).toEqual([]);
    expect(state.items[0]).toEqual(original);
    expect(report.replies).toBeUndefined();
  });

  it("attaches reply copy to older pending posts before they are sent", async () => {
    let saved = [item({ text: "CoLateral is where I build my own tools." })];
    const post = vi.fn(async () => {
      expect(saved[0].plugText).toBe(plugReplyFor(saved[0].text, saved[0].id, config()));
      return { containerId: "container", postId: "main" };
    });
    const runDeps: ThreadsRunDeps = { read: async () => structuredClone(saved), write: async (next) => { saved = structuredClone(next); }, post };
    await runDue(now, { config: config(), deps: runDeps, log: silent });
    expect(post).toHaveBeenCalledTimes(1);
    expect(saved[0].plugText).toContain("colateralai.com");
  });

  it("upgrades untouched replies to the current edited parent copy", async () => {
    const { runDeps, state } = deps([published({ text: "CoLateral is the ADE I build in.", plugText: "old stale reply" })]);
    await runDue(now, { config: config(), deps: runDeps, log: silent });
    expect(state.items[0].plugText).toBe(plugReplyFor(state.items[0].text, state.items[0].id, config()));
  });

  it("keeps reply copy fixed once an attempt or container exists", async () => {
    const { runDeps, state, posted } = deps([published({ plugText: "approved exact reply", plugAttempts: 1, plugContainerId: "old-container" })]);
    await runDue(now, { config: config(), deps: runDeps, log: silent });
    expect(posted[0].text).toBe("approved exact reply");
    expect(state.items[0].plugText).toBe("approved exact reply");
  });

  it("backs off reply failures separately and reuses their container", async () => {
    const post = vi.fn<ThreadsRunDeps["post"]>()
      .mockRejectedValueOnce(new ContainerPendingError("reply-container", "not ready"))
      .mockResolvedValueOnce({ containerId: "reply-container", postId: "reply" });
    const { runDeps, state } = deps([published()], post);
    const first = await runDue(now, { config: config(), deps: runDeps, log: silent });
    expect(first).toMatchObject({ published: 0, failed: 0, replies: { retrying: 1, failed: 0 } });
    expect(state.items[0]).toMatchObject({ status: "published", plugAttempts: 1, plugNextAttemptAt: "2026-07-22T07:25:00.000Z" });
    await runDue(new Date("2026-07-22T07:21:00Z"), { config: config(), deps: runDeps, log: silent });
    expect(post).toHaveBeenCalledTimes(1);
    await runDue(new Date("2026-07-22T07:25:00Z"), { config: config(), deps: runDeps, log: silent });
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ containerId: "reply-container", replyToId: "parent" }));
    expect(state.items[0].plugNextAttemptAt).toBeUndefined();
    expect(state.items[0].plugPostId).toBe("reply");
  });

  it("respects a fresh reply lease and resumes an abandoned one", async () => {
    const { runDeps, state, posted } = deps([published({ plugText: "claimed copy", plugClaimedAt: "2026-07-22T07:19:00Z", plugContainerId: "claimed-container" })]);
    await runDue(now, { config: config(), deps: runDeps, log: silent });
    expect(posted).toHaveLength(0);
    await runDue(new Date("2026-07-22T07:30:00Z"), { config: config(), deps: runDeps, log: silent });
    expect(posted).toHaveLength(1);
    expect(state.items[0].plugClaimedAt).toBeUndefined();
  });

  it("preserves the handle on a permanent reply rejection", async () => {
    const { runDeps, state } = deps([published()], async () => { throw new ContainerRejectedError("rejected-container", "invalid reply"); });
    const report = await runDue(now, { config: config(), deps: runDeps, log: silent });
    expect(report).toMatchObject({ published: 0, failed: 0, replies: { failed: 1 } });
    expect(state.items[0]).toMatchObject({ status: "published", plugDropped: true, plugContainerId: "rejected-container", plugAttempts: 1 });
  });

  it("caps fresh historical reply sends and never backfills old or timestamp-less history", async () => {
    const recent = Array.from({ length: 5 }, (_, index) => published({ id: `recent-${index}`, slot: index + 1 }));
    const { runDeps, state, posted } = deps([...recent, published({ id: "old", publishedAt: "2026-07-21T07:15:00Z" }), published({ id: "unknown", publishedAt: undefined })]);
    const report = await runDue(now, { config: config(), deps: runDeps, log: silent });
    expect(posted).toHaveLength(3);
    expect(report.replies?.published).toBe(3);
    expect(state.items.find((entry) => entry.id === "old")?.plugText).toBeUndefined();
    expect(state.items.find((entry) => entry.id === "unknown")?.plugText).toBeUndefined();
  });

  it("dry-runs reply delivery without changing or saving any queue fields", async () => {
    const original = [published()];
    const { runDeps, state, posted } = deps(original);
    const write = vi.spyOn(runDeps, "write");
    const report = await runDue(now, { config: config(), deps: runDeps, dryRun: true, log: silent });
    expect(report.replies?.published).toBe(1);
    expect(state.items).toEqual(original);
    expect(write).not.toHaveBeenCalled();
    expect(posted).toHaveLength(0);
  });

  it("pauses after container creation without consuming an attempt and resumes the handle", async () => {
    const live = config();
    const post = vi.fn<ThreadsRunDeps["post"]>()
      .mockImplementationOnce(async (input) => {
        await input.onContainerCreated?.("paused-container");
        vi.mocked(isAutomationPaused).mockResolvedValue(true);
        expect(await input.shouldPublish?.()).toBe(false);
        throw new ThreadsPublishPausedError("paused-container");
      })
      .mockImplementationOnce(async (input) => {
        expect(input.containerId).toBe("paused-container");
        expect(await input.shouldPublish?.()).toBe(true);
        return { containerId: "paused-container", postId: "reply" };
      });
    const { runDeps, state } = deps([published()], post);
    await runDue(now, { config: live, deps: runDeps, log: silent });
    expect(state.items[0]).toMatchObject({ status: "published", plugContainerId: "paused-container" });
    expect(state.items[0].plugAttempts).toBeUndefined();
    expect(state.items[0].plugClaimedAt).toBeUndefined();
    vi.mocked(isAutomationPaused).mockResolvedValue(false);
    await runDue(now, { config: live, deps: runDeps, log: silent });
    expect(state.items[0].plugPostId).toBe("reply");
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("checks a switch changed during a network wait before publishing", async () => {
    const live = config();
    const post = vi.fn<ThreadsRunDeps["post"]>(async (input) => {
      await input.onContainerCreated?.("stopped-container");
      live.plugReplies = false;
      expect(await input.shouldPublish?.()).toBe(false);
      throw new ThreadsPublishPausedError("stopped-container");
    });
    const { runDeps, state } = deps([published()], post);
    await runDue(now, { config: live, deps: runDeps, log: silent });
    await runDue(now, { config: live, deps: runDeps, log: silent });
    expect(post).toHaveBeenCalledTimes(1);
    expect(state.items[0].plugAttempts).toBeUndefined();
  });

  it.each([false, true])("never ordinarily resends a known accepted receipt after a failed save (reply=%s)", async (reply) => {
    let saved = [reply ? published() : item()];
    let failReceiptSave = true;
    const post = vi.fn<ThreadsRunDeps["post"]>(async (input) => {
      await input.onContainerCreated?.("durable-container");
      return { containerId: "durable-container", postId: "accepted" };
    });
    const runDeps: ThreadsRunDeps = {
      read: async () => structuredClone(saved),
      write: async (next) => {
        const hasReceipt = reply ? next[0].plugPostId : next[0].postId;
        if (hasReceipt && failReceiptSave) { failReceiptSave = false; throw new Error("disk unavailable"); }
        saved = structuredClone(next);
      },
      post
    };
    const first = await runDue(now, { config: config(), deps: runDeps, log: silent });
    expect(first.failed).toBe(0);
    expect(first.persistenceError).toContain("disk unavailable");
    expect(reply ? first.replies?.published : first.published).toBe(1);
    expect(reply ? saved[0].plugContainerId : saved[0].containerId).toBe("durable-container");
    expect(reply ? saved[0].plugAttempts : saved[0].attempts).toBe(reply ? undefined : 0);
    await runDue(now, { config: config(), deps: runDeps, log: silent });
    expect(post).toHaveBeenCalledTimes(1);
    expect(reply ? saved[0].plugPostId : saved[0].postId).toBe("accepted");
  });

  it("stops before publishing on a failed container save and keeps API attempts unchanged", async () => {
    let saved = [item()];
    let failing = true;
    const post = vi.fn<ThreadsRunDeps["post"]>(async (input) => {
      if (!input.containerId) await input.onContainerCreated?.("created-container");
      return { containerId: "created-container", postId: "accepted" };
    });
    const runDeps: ThreadsRunDeps = {
      read: async () => structuredClone(saved),
      write: async (next) => {
        if (next[0].containerId && failing) throw new Error("cannot save handle");
        saved = structuredClone(next);
      }, post
    };
    const first = await runDue(now, { config: config(), deps: runDeps, log: silent });
    expect(first).toMatchObject({ published: 0, failed: 0 });
    expect(first.persistenceError).toContain("cannot save handle");
    expect(saved[0].attempts).toBe(0);
    failing = false;
    await runDue(now, { config: config(), deps: runDeps, log: silent });
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ containerId: "created-container" }));
    expect(saved[0].postId).toBe("accepted");
  });
});
