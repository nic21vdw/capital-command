import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAutomationPaused } from "@/lib/automations/store";
import { planAdhocPosts } from "@/lib/threads/adhoc";
import { ContainerPendingError, ThreadsPublishPausedError } from "@/lib/threads/api";
import { threadsConfig, type ThreadsConfig } from "@/lib/threads/config";
import { planBatch } from "@/lib/threads/plan";
import { editItemText, readQueue, writeQueue } from "@/lib/threads/queue";
import { runDue, type ThreadsRunDeps } from "@/lib/threads/runner";
import type { ThreadsQueueItem } from "@/lib/threads/types";
import type { XDailyPack } from "@/types/domain";

const post = vi.hoisted(() => vi.fn());
vi.mock("@/lib/threads/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/threads/api")>(),
  postToThreads: post
}));

const START = new Date("2026-10-03T12:00:00.000Z");
const quiet = () => {};

function config(overrides: Partial<ThreadsConfig> = {}): ThreadsConfig {
  return {
    ...threadsConfig(),
    timezone: "UTC",
    plugReplies: true,
    plugDelayMinutes: 2,
    plugWindowMinutes: 360,
    accounts: [
      { id: "primary", label: "Primary test", userId: "test-1", accessToken: "fake-primary-token", posts: "text", offsetMinutes: 0 },
      { id: "secondary", label: "Secondary test", userId: "test-2", accessToken: "fake-secondary-token", posts: "variant", offsetMinutes: 0 }
    ],
    ...overrides
  };
}

function pack(): XDailyPack {
  return {
    id: "exposure-test-pack",
    date: "2026-10-03",
    source: "library",
    createdAt: START.toISOString(),
    replies: [],
    posts: [
      { id: "tools", slot: 1, time: "12:01", topic: "custom tools", format: "insight", text: "I turned another repetitive calculation into my own tool.", threadsVariant: "Making a small tool for a repetitive calculation saved me another spreadsheet detour." },
      { id: "workflow", slot: 2, time: "12:03", topic: "small improvement", format: "insight", text: "The best fix today was removing three clicks from my morning.", threadsVariant: "Three fewer clicks every morning feels tiny until you do it for a month." }
    ]
  };
}

function planned(configured: ThreadsConfig = config()): ThreadsQueueItem[] {
  let id = 0;
  return planBatch({ pack: pack(), config: configured, now: START, newId: () => `exposure-${++id}` }).items;
}

async function tick(at: string, configured = config(), deps?: ThreadsRunDeps) {
  const now = new Date(at);
  vi.setSystemTime(now);
  return runDue(now, { config: configured, deps, log: quiet });
}

beforeEach(async () => {
  // Freeze Date only: filesystem work and concurrency assertions still use real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  post.mockReset();
  await writeQueue([]);
  await setAutomationPaused("threads", false);
  let published = 0;
  post.mockImplementation(async () => ({ containerId: `test-container-${++published}`, postId: `test-post-${published}` }));
});

afterEach(async () => {
  await setAutomationPaused("threads", false);
  vi.useRealTimers();
});

describe("Threads exposure across real planners and saved queue", () => {
  it("adds one delayed, contextual self-reply for every daily version and pipeline post", async () => {
    const configured = config();
    const daily = planned(configured);
    const pipeline = planAdhocPosts({
      texts: ["My workspace finally keeps the terminal and browser together. Switching between tabs was getting old."],
      config: configured,
      now: START,
      taken: new Set(daily.map((item) => item.publishAt)),
      leadHours: 0,
      runId: "test-stream",
      newId: () => "exposure-pipeline"
    });
    const scheduled = [...daily, ...pipeline];
    expect(scheduled).toHaveLength(5);
    for (const item of scheduled) {
      expect(item.text).not.toMatch(/colateralai\.com/i);
      expect(item.plugText).toMatch(/CoLateral/i);
      expect(item.plugText).toContain("https://colateralai.com/th");
      expect(item.plugText!.length).toBeLessThanOrEqual(500);
      expect(item.plugText).not.toMatch(/[\u2013\u2014]/);
    }
    const toolLink = new URL(daily.find((item) => item.id === "exposure-1")!.plugText!.match(/https:\/\/\S+$/)![0]);
    const workspaceLink = new URL(pipeline[0].plugText!.match(/https:\/\/\S+$/)![0]);
    expect(toolLink.searchParams.get("utm_content")).toBe("autopilot-custom-tools");
    expect(workspaceLink.searchParams.get("utm_content")).toBe("pipeline-workspace");
    await writeQueue(scheduled);

    await tick("2026-10-03T12:03:00.000Z", configured);
    const mainCalls = post.mock.calls.map(([input]) => input);
    expect(mainCalls).toHaveLength(5);
    expect(mainCalls.every((input) => !input.replyToId)).toBe(true);
    const publishedParents = await readQueue();
    expect(publishedParents.every((item) => item.status === "published" && item.postId)).toBe(true);

    await tick("2026-10-03T12:04:00.000Z", configured);
    expect(post).toHaveBeenCalledTimes(5);
    const report = await tick("2026-10-03T12:05:00.000Z", configured);
    expect(report.published).toBe(0);
    expect(report.replies?.published).toBe(3);
    const remaining = await tick("2026-10-03T12:10:00.000Z", configured);
    expect(remaining.published).toBe(0);
    expect(remaining.replies?.published).toBe(2);
    const replyCalls = post.mock.calls.slice(5).map(([input]) => input);
    expect(replyCalls).toHaveLength(5);
    for (const parent of publishedParents) {
      const replies = replyCalls.filter((input) => input.replyToId === parent.postId);
      expect(replies).toHaveLength(1);
      expect(replies[0].account.id).toBe(parent.accountId);
      expect(replies[0].text).toBe(parent.plugText);
    }
    expect((await readQueue()).every((item) => item.plugPostId)).toBe(true);
    await tick("2026-10-03T12:15:00.000Z", configured);
    expect(post).toHaveBeenCalledTimes(10);
  });

  it("honors live disable and pause after planning, then resumes each reply once", async () => {
    const configured = config({ postsPerDay: 1 });
    await writeQueue(planned(configured));
    await tick("2026-10-03T12:01:00.000Z", configured);
    const parents = await readQueue();
    expect(post).toHaveBeenCalledTimes(2);

    await tick("2026-10-03T12:03:00.000Z", { ...configured, plugReplies: false });
    expect(post).toHaveBeenCalledTimes(2);
    await setAutomationPaused("threads", true);
    const paused = await tick("2026-10-03T12:04:00.000Z", configured);
    expect(paused.note).toContain("paused");
    expect(post).toHaveBeenCalledTimes(2);
    expect((await readQueue()).map((item) => item.postId)).toEqual(parents.map((item) => item.postId));

    await setAutomationPaused("threads", false);
    await tick("2026-10-03T12:05:00.000Z", configured);
    await tick("2026-10-03T12:06:00.000Z", configured);
    expect(post).toHaveBeenCalledTimes(4);
    expect((await readQueue()).every((item) => item.status === "published" && item.plugPostId)).toBe(true);
  });

  it("bases an unattempted follow-up on revised parent copy rather than its original topic", async () => {
    const configured = config({ postsPerDay: 1, accounts: config().accounts.slice(0, 1) });
    const queued = planned(configured);
    const oldReply = queued[0].plugText;
    const editedText = "My multiplayer game needs smoother character animations before the next release.";
    const edited = editItemText(queued, queued[0].id, editedText);
    expect(edited.changed).toBe(1);
    await writeQueue(edited.items);
    await tick("2026-10-03T12:01:00.000Z", configured);
    const parent = (await readQueue())[0];
    const destination = new URL(parent.plugText!.match(/https:\/\/\S+$/)![0]);
    expect(parent.plugText).not.toBe(oldReply);
    expect(destination.searchParams.get("utm_content")).toBe("autopilot-games");
    expect(post.mock.calls[0][0].text).toBe(editedText);
    await tick("2026-10-03T12:03:00.000Z", configured);
    expect(post.mock.calls[1][0]).toMatchObject({ text: parent.plugText, replyToId: parent.postId });
  });

  it("backs off a processing reply and resumes its saved container without reposting its parent", async () => {
    const configured = config({ postsPerDay: 1, accounts: config().accounts.slice(0, 1), backoffBaseMinutes: 5 });
    await writeQueue(planned(configured));
    await tick("2026-10-03T12:01:00.000Z", configured);
    const parentId = (await readQueue())[0].postId;
    post.mockImplementationOnce(async () => { throw new ContainerPendingError("reply-container", "Still processing"); });

    const retry = await tick("2026-10-03T12:03:00.000Z", configured);
    expect(retry.failed).toBe(0);
    expect(retry.replies?.retrying).toBe(1);
    expect((await readQueue())[0]).toMatchObject({
      status: "published", postId: parentId, plugContainerId: "reply-container", plugAttempts: 1,
      plugNextAttemptAt: "2026-10-03T12:08:00.000Z"
    });
    await tick("2026-10-03T12:04:00.000Z", configured);
    expect(post).toHaveBeenCalledTimes(2);
    const resumed = await tick("2026-10-03T12:08:00.000Z", configured);
    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls[2][0]).toMatchObject({ containerId: "reply-container", replyToId: parentId, account: { id: "primary" } });
    expect(resumed.replies?.published).toBe(1);
    await tick("2026-10-03T12:20:00.000Z", configured);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("does not send two replies when overlapping runner calls start from a saved queue", async () => {
    const configured = config({ postsPerDay: 1, accounts: config().accounts.slice(0, 1) });
    await writeQueue(planned(configured));
    await tick("2026-10-03T12:01:00.000Z", configured);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    post.mockImplementationOnce(async () => {
      await waiting;
      return { containerId: "reply-container", postId: "reply-post" };
    });
    const first = tick("2026-10-03T12:03:00.000Z", configured);
    try {
      await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
      const overlapping = await tick("2026-10-03T12:03:00.000Z", configured);
      expect(overlapping.note).toContain("already in progress");
      expect(post).toHaveBeenCalledTimes(2);
    } finally {
      release();
      await first;
    }
    await tick("2026-10-03T12:10:00.000Z", configured);
    expect(post).toHaveBeenCalledTimes(2);
    expect((await readQueue())[0].plugPostId).toBe("reply-post");
  });

  it("keeps a container created while pause changes and resumes without consuming an attempt", async () => {
    const configured = config({ postsPerDay: 1, accounts: config().accounts.slice(0, 1) });
    await writeQueue(planned(configured));
    await tick("2026-10-03T12:01:00.000Z", configured);
    post.mockImplementationOnce(async (input) => {
      await input.onContainerCreated("paused-reply-container");
      await setAutomationPaused("threads", true);
      expect(await input.shouldPublish()).toBe(false);
      throw new ThreadsPublishPausedError("paused-reply-container");
    });
    await tick("2026-10-03T12:03:00.000Z", configured);
    expect((await readQueue())[0]).toMatchObject({ status: "published", plugContainerId: "paused-reply-container" });
    expect((await readQueue())[0].plugAttempts ?? 0).toBe(0);
    expect((await readQueue())[0].plugPostId).toBeUndefined();
    await setAutomationPaused("threads", false);
    await tick("2026-10-03T12:05:00.000Z", configured);
    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls[2][0]).toMatchObject({ containerId: "paused-reply-container" });
    expect((await readQueue())[0].plugPostId).toBeDefined();
  });

  it("retains an accepted reply through a failed queue save instead of resending", async () => {
    const configured = config({ postsPerDay: 1, accounts: config().accounts.slice(0, 1) });
    let saved = planned(configured).map((item) => ({
      ...item, status: "published" as const, postId: "saved-parent", publishedAt: "2026-10-03T12:01:00.000Z"
    }));
    let failedAfterAcceptance = false;
    const deps: ThreadsRunDeps = {
      read: async () => structuredClone(saved),
      write: async (items) => {
        if (items.some((item) => item.plugPostId) && !failedAfterAcceptance) {
          failedAfterAcceptance = true;
          throw new Error("Synthetic disk failure after reply acceptance");
        }
        saved = structuredClone(items) as typeof saved;
      },
      post: async () => ({ containerId: "accepted-container", postId: "accepted-reply" })
    };
    const send = vi.spyOn(deps, "post");
    const acceptance = await tick("2026-10-03T12:03:00.000Z", configured, deps);
    expect(failedAfterAcceptance).toBe(true);
    expect(acceptance.replies?.published).toBe(1);
    expect(acceptance.persistenceError).toContain("Synthetic disk failure after reply acceptance");
    await tick("2026-10-03T12:10:00.000Z", configured, deps);
    expect(send).toHaveBeenCalledTimes(1);
    expect(saved[0]).toMatchObject({ status: "published", postId: "saved-parent", plugPostId: "accepted-reply" });
  });
});
