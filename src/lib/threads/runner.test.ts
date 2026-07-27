import { describe, expect, it, vi } from "vitest";
import { PermanentError } from "@/lib/publisher/http";
import { ContainerPendingError } from "@/lib/threads/api";
import { threadsConfig, type ThreadsConfig } from "@/lib/threads/config";
import { runDue, type ThreadsRunDeps } from "@/lib/threads/runner";
import type { ThreadsQueueItem } from "@/lib/threads/types";

function config(overrides: Partial<ThreadsConfig> = {}): ThreadsConfig {
  return { ...threadsConfig(), timezone: "UTC", userId: "1", accessToken: "token", ...overrides };
}

function item(overrides: Partial<ThreadsQueueItem> = {}): ThreadsQueueItem {
  return {
    id: "item-1",
    batchDate: "2026-07-22",
    slot: 1,
    role: "main",
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
  const posted: Array<{ text: string; replyToId?: string }> = [];
  const runDeps: ThreadsRunDeps = {
    read: async () => state.items,
    write: async (next) => {
      state.items = next;
    },
    post:
      post ??
      (async (input) => {
        posted.push({ text: input.text, replyToId: input.replyToId });
        return { containerId: "container-1", postId: `post-${posted.length}` };
      })
  };
  return { runDeps, state, posted };
}

const silent = () => {};

describe("runDue", () => {
  it("posts an item once its time has come", async () => {
    const { runDeps, state, posted } = deps([item()]);

    const report = await runDue(new Date("2026-07-22T07:16:00.000Z"), { config: config(), deps: runDeps, log: silent });

    expect(report.published).toBe(1);
    expect(posted).toEqual([{ text: "the post", replyToId: undefined }]);
    expect(state.items[0]).toMatchObject({ status: "published", postId: "post-1" });
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

  it("posts a variant as a reply to its published main", async () => {
    const main = item({ id: "main-1" });
    const variant = item({
      id: "variant-1",
      role: "variant",
      text: "the rewrite",
      publishAt: "2026-07-22T07:18:00.000Z",
      replyToItemId: "main-1"
    });
    const { runDeps, posted } = deps([main, variant]);

    await runDue(new Date("2026-07-22T07:20:00.000Z"), { config: config(), deps: runDeps, log: silent });

    expect(posted).toEqual([
      { text: "the post", replyToId: undefined },
      { text: "the rewrite", replyToId: "post-1" }
    ]);
  });

  it("holds a reply back until the post it answers is live", async () => {
    const variant = item({
      id: "variant-1",
      role: "variant",
      publishAt: "2026-07-22T07:18:00.000Z",
      replyToItemId: "main-1"
    });
    const { runDeps, posted } = deps([item({ id: "main-1", publishAt: "2026-07-22T07:30:00.000Z" }), variant]);

    const report = await runDue(new Date("2026-07-22T07:19:00.000Z"), {
      config: config(),
      deps: runDeps,
      log: silent
    });

    expect(posted).toHaveLength(0);
    expect(report.outcomes[0]).toMatchObject({ outcome: "waiting" });
  });

  it("skips a reply whose main permanently failed", async () => {
    const { runDeps, state } = deps([
      item({ id: "main-1", status: "failed" }),
      item({ id: "variant-1", role: "variant", publishAt: "2026-07-22T07:18:00.000Z", replyToItemId: "main-1" })
    ]);

    await runDue(new Date("2026-07-22T07:20:00.000Z"), { config: config(), deps: runDeps, log: silent });

    expect(state.items.find((entry) => entry.id === "variant-1")?.status).toBe("skipped");
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

  it("does nothing at all when Threads is not connected", async () => {
    const { runDeps, posted } = deps([item()]);

    const report = await runDue(new Date("2026-07-22T07:16:00.000Z"), {
      config: config({ accessToken: null }),
      deps: runDeps,
      log: silent
    });

    expect(posted).toHaveLength(0);
    expect(report.note).toContain("not connected");
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
