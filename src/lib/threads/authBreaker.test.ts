import { rm } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { PermanentError } from "@/lib/publisher/http";
import { recordAutomationEventSafely } from "@/lib/automations/history";
import { threadsAccountFingerprint } from "@/lib/platform-health/fingerprint";
import { AUTH_PROBE_MINUTES, readAuthStates, recordAuthFailure } from "@/lib/platform-health/store";
import { ContainerRejectedError, type ThreadsPublishInput } from "@/lib/threads/api";
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

function account(id: "primary" | "secondary", overrides: Partial<ThreadsAccount> = {}): ThreadsAccount {
  return {
    id,
    label: id === "primary" ? "nic_vandewetering" : "second_handle",
    userId: id === "primary" ? "1" : "2",
    accessToken: id === "primary" ? "token-a" : "token-s",
    posts: id === "primary" ? "text" : "variant",
    offsetMinutes: 0,
    ...overrides
  };
}

function config(accounts: ThreadsAccount[] = [account("primary")]): ThreadsConfig {
  return { ...threadsConfig(), timezone: "UTC", accounts };
}

const both = () => config([account("primary"), account("secondary")]);

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

let sent = 0;
function posting(rejects: Array<"primary" | "secondary"> = []) {
  return vi.fn(async (input: ThreadsPublishInput): Promise<{ containerId: string; postId: string }> => {
    if ((rejects as string[]).includes(input.account.id)) throw new PermanentError(THREADS_401);
    sent += 1;
    return { containerId: `c-${sent}`, postId: `p-${sent}` };
  });
}

beforeEach(async () => {
  sent = 0;
  vi.mocked(recordAutomationEventSafely).mockClear();
  await rm(dataPath("platform-auth.json"), { force: true });
});

describe("the Threads auth breaker", () => {
  it("stops an account at its first auth failure instead of spending every slot on a dead token", async () => {
    const post = posting(["primary"]);
    const { runDeps } = queue([item("a", 1), item("b", 2), item("c", 3), item("d", 4)], post);

    const report = await runDue(NOW, { config: config(), deps: runDeps, log: silent });

    expect(post).toHaveBeenCalledTimes(1);
    expect(report.failed).toBe(0);
    expect(report.authFailures).toEqual([{ accountId: "primary", reason: expect.stringContaining("Session has expired") }]);
  });

  it("keeps the other account posting while one account's token is dead", async () => {
    const post = posting(["primary"]);
    const rows = [
      item("a", 1),
      item("b", 2, { accountId: "secondary", version: "variant" }),
      item("c", 3),
      item("d", 4, { accountId: "secondary", version: "variant" })
    ];
    const { runDeps, state } = queue(rows, post);

    const report = await runDue(NOW, { config: both(), deps: runDeps, log: silent });

    expect(report.published).toBe(2);
    expect(report.failed).toBe(0);
    expect(state.items.filter((row) => row.accountId === "secondary").map((row) => row.status)).toEqual(["published", "published"]);
    expect(state.items.filter((row) => row.accountId === "primary")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "a", status: "pending", attempts: 0 }),
        expect.objectContaining({ id: "c", status: "pending", attempts: 0 })
      ])
    );
    expect(Object.keys(await readAuthStates())).toEqual(["threads:primary"]);
  });

  it("leaves every item of the broken account pending with its retries intact, including the one that hit the wall", async () => {
    const items = [item("a", 1), item("b", 2), item("c", 3)];
    const { runDeps, state } = queue(items, posting(["primary"]));

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

  it("records the account, when it broke, why, and the fix link", async () => {
    const { runDeps } = queue([item("a", 1)], posting(["primary"]));

    await runDue(NOW, { config: config(), deps: runDeps, log: silent });

    expect((await readAuthStates())["threads:primary"]).toMatchObject({
      platform: "threads",
      accountId: "primary",
      accountLabel: "nic_vandewetering",
      since: NOW.toISOString(),
      reason: expect.stringContaining("Session has expired"),
      fixUrl: "/settings#accounts"
    });
  });

  it("tells the automations history it was blocked, not that the post failed", async () => {
    const { runDeps } = queue([item("a", 1)], posting(["primary"]));

    await runDue(NOW, { config: config(), deps: runDeps, log: silent });

    expect(recordAutomationEventSafely).toHaveBeenCalledWith(
      expect.objectContaining({ automationId: "threads", kind: "blocked", itemId: "a" })
    );
    expect(recordAutomationEventSafely).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "failed" }));
  });

  it("makes no call for the broken account on later ticks while its token is unchanged, but still posts the other", async () => {
    const rows = [
      item("a", 1),
      item("b", 2, { accountId: "secondary", version: "variant" }),
      item("c", 3),
      item("e", 24, { accountId: "secondary", version: "variant" })
    ];
    const { runDeps, state } = queue(rows, posting(["primary"]));
    await runDue(NOW, { config: both(), deps: runDeps, log: silent });
    const later = posting(["primary"]);

    const report = await runDue(new Date(NOW.getTime() + 15 * MINUTE), { config: both(), deps: { ...runDeps, post: later }, log: silent });

    expect(later).toHaveBeenCalledTimes(1);
    expect(later.mock.calls[0][0].account.id).toBe("secondary");
    expect(report.published).toBe(1);
    expect(state.items.filter((row) => row.accountId === "primary").every((row) => row.status === "pending" && row.attempts === 0)).toBe(true);
  });

  it("makes no call at all once every account is held, and says where to fix it", async () => {
    const { runDeps, state } = queue([item("a", 1), item("b", 2, { accountId: "secondary", version: "variant" })], posting(["primary", "secondary"]));
    await runDue(NOW, { config: both(), deps: runDeps, log: silent });
    expect(Object.keys(await readAuthStates()).sort()).toEqual(["threads:primary", "threads:secondary"]);
    const second = posting();

    const report = await runDue(new Date(NOW.getTime() + 5 * MINUTE), { config: both(), deps: { ...runDeps, post: second }, log: silent });

    expect(second).not.toHaveBeenCalled();
    expect(report.note).toContain("Settings");
    expect(state.items.every((row) => row.status === "pending" && row.attempts === 0)).toBe(true);
  });

  it("tries once after the wait and picks the feed back up when that call works", async () => {
    const { runDeps, state } = queue([item("a", 1), item("b", 2)], posting(["primary"]));
    await runDue(NOW, { config: config(), deps: runDeps, log: silent });

    const post = posting();
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
    const { runDeps } = queue([item("a", 1)], posting(["primary"]));
    await runDue(NOW, { config: config(), deps: runDeps, log: silent });
    const trial = new Date(NOW.getTime() + (AUTH_PROBE_MINUTES + 1) * MINUTE);

    await runDue(trial, { config: config(), deps: runDeps, log: silent });
    const post = posting();
    await runDue(new Date(trial.getTime() + 5 * MINUTE), { config: config(), deps: { ...runDeps, post }, log: silent });

    expect(post).not.toHaveBeenCalled();
    expect((await readAuthStates())["threads:primary"]).toMatchObject({ since: NOW.toISOString(), failures: 2 });
  });

  it("posts again straight away when that account's token changes", async () => {
    const { runDeps, state } = queue([item("a", 1), item("b", 2)], posting(["primary"]));
    await runDue(NOW, { config: config(), deps: runDeps, log: silent });

    const post = posting();
    const report = await runDue(new Date(NOW.getTime() + 2 * MINUTE), {
      config: config([account("primary", { accessToken: "token-b" })]),
      deps: { ...runDeps, post },
      log: silent
    });

    expect(report.published).toBe(2);
    expect(state.items.every((entry) => entry.status === "published")).toBe(true);
    expect(await readAuthStates()).toEqual({});
  });

  it("does not clear one account's break because the other account posted", async () => {
    const live = both();
    await recordAuthFailure(
      { platform: "threads", accountId: "primary", accountLabel: "nic_vandewetering" },
      "Session has expired",
      { now: NOW, fingerprint: threadsAccountFingerprint(live.accounts[0]) }
    );
    const { runDeps } = queue([item("a", 1), item("b", 2, { accountId: "secondary", version: "variant" })], posting());

    const report = await runDue(new Date(NOW.getTime() + MINUTE), { config: live, deps: runDeps, log: silent });

    expect(report.published).toBe(1);
    expect(Object.keys(await readAuthStates())).toEqual(["threads:primary"]);
  });

  it("clears an account's state when its own call succeeds, and only that one", async () => {
    const live = both();
    const brokenSince = new Date(NOW.getTime() - 60 * MINUTE);
    await recordAuthFailure({ platform: "threads", accountId: "primary" }, "x", { now: brokenSince, fingerprint: threadsAccountFingerprint(live.accounts[0]) });
    await recordAuthFailure({ platform: "threads", accountId: "secondary" }, "y", { now: brokenSince, fingerprint: threadsAccountFingerprint(live.accounts[1]) });
    const { runDeps } = queue([item("a", 1)], posting());

    const report = await runDue(NOW, { config: live, deps: runDeps, log: silent });

    expect(report.published).toBe(1);
    expect(Object.keys(await readAuthStates())).toEqual(["threads:secondary"]);
  });

  it("does not let a dry run trip or read the breaker", async () => {
    const live = config();
    await recordAuthFailure({ platform: "threads", accountId: "primary" }, "Session has expired", {
      now: NOW,
      fingerprint: threadsAccountFingerprint(live.accounts[0])
    });
    const post = posting();
    const { runDeps } = queue([item("a", 1)], post);

    const report = await runDue(new Date(NOW.getTime() + MINUTE), { config: live, deps: runDeps, dryRun: true, log: silent });

    expect(report.outcomes).toHaveLength(1);
    expect(post).not.toHaveBeenCalled();
  });

  it("stops an account on an auth failure while sending a link reply, without spending the reply's attempts", async () => {
    const published = item("a", 1, {
      status: "published",
      postId: "post-main",
      publishedAt: "2026-07-22T07:11:00.000Z",
      text: "CoLateral is where I build my own tools.",
      plugText: "what I'm building: https://colateralai.com"
    });
    const pending = item("b", 9);
    const post = posting(["primary"]);
    const { runDeps, state } = queue([published, pending], post);

    const report = await runDue(NOW, { config: config(), deps: runDeps, log: silent });

    expect(post).toHaveBeenCalledTimes(1);
    expect(report.authFailures).toHaveLength(1);
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
    expect(report.authFailures).toBeUndefined();
    expect(state.items.map((entry) => entry.status)).toEqual(["failed", "failed"]);
    expect(await readAuthStates()).toEqual({});
  });
});
