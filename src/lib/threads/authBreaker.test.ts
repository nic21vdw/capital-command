import { rm } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { PermanentError } from "@/lib/publisher/http";
import { recordAutomationEventSafely } from "@/lib/automations/history";
import { threadsFingerprint } from "@/lib/platform-health/fingerprint";
import { AUTH_PROBE_MINUTES, readAuthStates, recordAuthFailure } from "@/lib/platform-health/store";
import { ContainerRejectedError } from "@/lib/threads/api";
import { threadsConfig, type ThreadsAccount, type ThreadsConfig } from "@/lib/threads/config";
import { runDue, type ThreadsRunDeps } from "@/lib/threads/runner";
import type { ThreadsQueueItem } from "@/lib/threads/types";

vi.mock("@/lib/automations/store", () => ({ isAutomationPaused: vi.fn(async () => false) }));
vi.mock("@/lib/automations/history", () => ({ recordAutomationEventSafely: vi.fn(async () => {}) }));

const THREADS_401 =
  'Threads profile (primary) failed (HTTP 401): {"error":{"message":"Error validating access token: Session has expired on Thursday, 24-Sep-26 20:13:48 PDT.","type":"OAuthException","code":190}}';

const NOW = new Date("2026-07-22T07:20:00.000Z");
const MINUTE = 60_000;
const silent = () => {};

function account(overrides: Partial<ThreadsAccount> = {}): ThreadsAccount {
  return { id: "primary", label: "primary", userId: "1", accessToken: "token-a", posts: "text", offsetMinutes: 0, ...overrides };
}

function config(accounts: ThreadsAccount[] = [account()]): ThreadsConfig {
  return { ...threadsConfig(), timezone: "UTC", accounts };
}

function item(id: string, minute: number, overrides: Partial<ThreadsQueueItem> = {}): ThreadsQueueItem {
  return {
    id,
    batchDate: "2026-07-22",
    slot: minute,
    accountId: "primary",
    version: "text",
    topic: "verification",
    format: "insight",
    text: `post ${id}`,
    publishAt: `2026-07-22T07:${String(10 + minute).padStart(2, "0")}:00.000Z`,
    status: "pending",
    attempts: 0,
    createdAt: "2026-07-22T06:00:00.000Z",
    ...overrides
  };
}

function queue(items: ThreadsQueueItem[], post: ThreadsRunDeps["post"]) {
  const state = { items: structuredClone(items) };
  const runDeps: ThreadsRunDeps = {
    read: async () => state.items,
    write: async (next) => {
      state.items = structuredClone(next);
    },
    post
  };
  return { runDeps, state };
}

const withoutReplyDraft = (rows: ThreadsQueueItem[]) =>
  rows.map((row) => {
    const copy = { ...row };
    delete copy.plugText;
    return copy;
  });

const deadToken = () =>
  vi.fn(async (): Promise<{ containerId: string; postId: string }> => {
    throw new PermanentError(THREADS_401);
  });

let sent = 0;
const goodToken = () =>
  vi.fn(async () => {
    sent += 1;
    return { containerId: `c-${sent}`, postId: `p-${sent}` };
  });

beforeEach(async () => {
  sent = 0;
  vi.mocked(recordAutomationEventSafely).mockClear();
  await rm(dataPath("platform-auth.json"), { force: true });
});

describe("the Threads auth breaker", () => {
  it("stops at the first auth failure instead of spending every slot on a dead token", async () => {
    const post = deadToken();
    const items = [item("a", 1), item("b", 2), item("c", 3), item("d", 4)];
    const { runDeps } = queue(items, post);

    const report = await runDue(NOW, { config: config(), deps: runDeps, log: silent });

    expect(post).toHaveBeenCalledTimes(1);
    expect(report.failed).toBe(0);
    expect(report.authFailure).toContain("Session has expired");
  });

  it("leaves every item pending with its retries intact, including the one that hit the wall", async () => {
    const items = [item("a", 1), item("b", 2), item("c", 3)];
    const { runDeps, state } = queue(items, deadToken());

    await runDue(NOW, { config: config(), deps: runDeps, log: silent });

    expect(withoutReplyDraft(state.items)).toEqual(items);
  });

  it("keeps a container that was already created so the next try resumes it", async () => {
    const post = vi.fn(async () => {
      throw new ContainerRejectedError("container-9", THREADS_401);
    });
    const { runDeps, state } = queue([item("a", 1), item("b", 2)], post);

    await runDue(NOW, { config: config(), deps: runDeps, log: silent });

    expect(state.items[0]).toMatchObject({ status: "pending", attempts: 0, containerId: "container-9" });
    expect(state.items[0].claimedAt).toBeUndefined();
    expect(state.items[1]).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("records the platform, when it broke, why, and the fix link", async () => {
    const { runDeps } = queue([item("a", 1)], deadToken());

    await runDue(NOW, { config: config(), deps: runDeps, log: silent });

    expect((await readAuthStates()).threads).toMatchObject({
      platform: "threads",
      since: NOW.toISOString(),
      reason: expect.stringContaining("Session has expired"),
      fixUrl: "/settings#accounts"
    });
  });

  it("tells the automations history it was blocked, not that the post failed", async () => {
    const { runDeps } = queue([item("a", 1)], deadToken());

    await runDue(NOW, { config: config(), deps: runDeps, log: silent });

    expect(recordAutomationEventSafely).toHaveBeenCalledWith(
      expect.objectContaining({ automationId: "threads", kind: "blocked", itemId: "a" })
    );
    expect(recordAutomationEventSafely).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "failed" }));
  });

  it("makes no call at all on later ticks while the token is unchanged", async () => {
    const first = deadToken();
    const items = [item("a", 1), item("b", 2)];
    const { runDeps, state } = queue(items, first);
    await runDue(NOW, { config: config(), deps: runDeps, log: silent });

    const second = goodToken();
    const report = await runDue(new Date(NOW.getTime() + 5 * MINUTE), {
      config: config(),
      deps: { ...runDeps, post: second },
      log: silent
    });

    expect(second).not.toHaveBeenCalled();
    expect(report.note).toContain("Settings");
    expect(report.authFailure).toContain("Session has expired");
    expect(withoutReplyDraft(state.items)).toEqual(items);
  });

  it("tries once after the wait and picks the feed back up when that call works", async () => {
    const { runDeps, state } = queue([item("a", 1), item("b", 2)], deadToken());
    await runDue(NOW, { config: config(), deps: runDeps, log: silent });

    const post = goodToken();
    const report = await runDue(new Date(NOW.getTime() + (AUTH_PROBE_MINUTES + 1) * MINUTE), {
      config: config(),
      deps: { ...runDeps, post },
      log: silent
    });

    expect(report.published).toBe(2);
    expect(state.items.map((entry) => entry.status)).toEqual(["published", "published"]);
    expect(await readAuthStates()).toEqual({});
  });

  it("pushes the next trial back when the trial fails too, and keeps the original break date", async () => {
    const { runDeps } = queue([item("a", 1)], deadToken());
    await runDue(NOW, { config: config(), deps: runDeps, log: silent });
    const trial = new Date(NOW.getTime() + (AUTH_PROBE_MINUTES + 1) * MINUTE);

    await runDue(trial, { config: config(), deps: runDeps, log: silent });
    const post = goodToken();
    await runDue(new Date(trial.getTime() + 5 * MINUTE), { config: config(), deps: { ...runDeps, post }, log: silent });

    expect(post).not.toHaveBeenCalled();
    expect((await readAuthStates()).threads).toMatchObject({ since: NOW.toISOString(), failures: 2 });
  });

  it("posts again straight away when the token changes", async () => {
    const { runDeps, state } = queue([item("a", 1), item("b", 2)], deadToken());
    await runDue(NOW, { config: config(), deps: runDeps, log: silent });

    const post = goodToken();
    const report = await runDue(new Date(NOW.getTime() + 2 * MINUTE), {
      config: config([account({ accessToken: "token-b" })]),
      deps: { ...runDeps, post },
      log: silent
    });

    expect(report.published).toBe(2);
    expect(state.items.every((entry) => entry.status === "published")).toBe(true);
    expect(await readAuthStates()).toEqual({});
  });

  it("clears the state when a call succeeds", async () => {
    const live = config();
    await recordAuthFailure("threads", "Session has expired", {
      now: new Date(NOW.getTime() - 60 * MINUTE),
      fingerprint: threadsFingerprint(live.accounts)
    });
    const { runDeps } = queue([item("a", 1)], goodToken());

    const report = await runDue(NOW, { config: live, deps: runDeps, log: silent });

    expect(report.published).toBe(1);
    expect(await readAuthStates()).toEqual({});
  });

  it("does not let a dry run trip or read the breaker", async () => {
    const live = config();
    await recordAuthFailure("threads", "Session has expired", { now: NOW, fingerprint: threadsFingerprint(live.accounts) });
    const post = goodToken();
    const { runDeps } = queue([item("a", 1)], post);

    const report = await runDue(new Date(NOW.getTime() + MINUTE), { config: live, deps: runDeps, dryRun: true, log: silent });

    expect(report.outcomes).toHaveLength(1);
    expect(post).not.toHaveBeenCalled();
  });

  it("stops on an auth failure while sending a link reply, without spending the reply's attempts", async () => {
    const published = item("a", 1, {
      status: "published",
      postId: "post-main",
      publishedAt: "2026-07-22T07:11:00.000Z",
      text: "CoLateral is where I build my own tools.",
      plugText: "what I'm building: https://colateralai.com"
    });
    const pending = item("b", 9);
    const post = deadToken();
    const { runDeps, state } = queue([published, pending], post);

    const report = await runDue(NOW, { config: config(), deps: runDeps, log: silent });

    expect(post).toHaveBeenCalledTimes(1);
    expect(report.authFailure).toBeDefined();
    expect(state.items[0]).toMatchObject({ status: "published", postId: "post-main" });
    expect(state.items[0].plugAttempts).toBeUndefined();
    expect(state.items[0].plugDropped).toBeUndefined();
    expect(state.items[0].plugPostId).toBeUndefined();
    expect(state.items[0].plugClaimedAt).toBeUndefined();
    expect(state.items[1]).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("still fails an item whose error is not about the token", async () => {
    const post = vi.fn(async () => {
      throw new PermanentError("Threads publish failed (HTTP 400): text too long");
    });
    const { runDeps, state } = queue([item("a", 1), item("b", 2)], post);

    const report = await runDue(NOW, { config: config(), deps: runDeps, log: silent });

    expect(report.failed).toBe(2);
    expect(report.authFailure).toBeUndefined();
    expect(state.items.map((entry) => entry.status)).toEqual(["failed", "failed"]);
    expect(await readAuthStates()).toEqual({});
  });
});
