import { describe, expect, it } from "vitest";
import { hasStarted, REWRITE_FAILED_REASON, REWRITE_STARTED_NO_ACCOUNT_REASON, REWRITE_STARTED_REASON, rewriteDecision } from "@/lib/threads/rewrite";
import type { ThreadsQueueItem } from "@/lib/threads/types";

const DATE = "2026-10-11";

function row(slot: number, status: ThreadsQueueItem["status"], extra: Partial<ThreadsQueueItem> = {}, accountId = "primary") {
  return { batchDate: DATE, slot, status, accountId, ...extra } as ThreadsQueueItem;
}

const pack = { posts: 6, replies: 20 };

describe("rewriteDecision", () => {
  it("is a plain write, with no confirmation, when no pack exists", () => {
    const decision = rewriteDecision({ packExists: false, items: [], date: DATE });
    expect(decision).toMatchObject({ mode: "write", allowed: true, reason: null, confirm: [] });
  });

  it("is a rewrite that asks first when a pack exists and nothing is queued", () => {
    const decision = rewriteDecision({ packExists: true, items: [], date: DATE, pack });
    expect(decision.mode).toBe("rewrite");
    expect(decision.allowed).toBe(true);
    expect(decision.replaces).toBe(0);
    expect(decision.confirm[0]).toContain("6 posts, 20 replies");
    expect(decision.confirm.join(" ")).toContain("Nothing is queued for today yet");
  });

  it("is frozen once any post has been published, with the reason a person can act on", () => {
    const decision = rewriteDecision({
      packExists: true,
      date: DATE,
      items: [row(1, "published", { postId: "t1" }), row(2, "pending"), row(3, "pending")]
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe(REWRITE_STARTED_REASON);
    expect(decision.counts).toMatchObject({ sent: 1, queued: 2 });
    expect(decision.confirm).toEqual([]);
  });

  it("does not claim posts are going out when no account is connected", () => {
    const items = [row(1, "published", { postId: "t1" }), row(2, "pending")];
    const withAccount = rewriteDecision({ packExists: true, items, date: DATE, autopilot: { noAccount: false } });
    const without = rewriteDecision({ packExists: true, items, date: DATE, autopilot: { noAccount: true } });
    expect(withAccount.reason).toBe(REWRITE_STARTED_REASON);
    expect(without.allowed).toBe(false);
    expect(without.reason).toBe(REWRITE_STARTED_NO_ACCOUNT_REASON);
    expect(without.reason).not.toContain("going out");
  });

  it.each([
    ["a post id", { postId: "t1" }],
    ["a created container", { containerId: "c1" }],
    ["a run that claimed it", { claimedAt: "2026-10-11T12:00:00.000Z" }]
  ])("treats %s as started even while the row still says pending", (_name, extra) => {
    const items = [row(1, "pending", extra), row(2, "pending")];
    expect(hasStarted(items[0])).toBe(true);
    expect(rewriteDecision({ packExists: true, items, date: DATE }).reason).toBe(REWRITE_STARTED_REASON);
  });

  it("is frozen when one account's version is out even if the other is still waiting", () => {
    const decision = rewriteDecision({
      packExists: true,
      date: DATE,
      items: [row(1, "published", { postId: "t1" }), row(1, "pending", {}, "secondary")]
    });
    expect(decision.allowed).toBe(false);
    expect(decision.counts).toMatchObject({ sent: 1, queued: 0 });
  });

  it("refuses while a post has failed, because Retry now would send its old wording beside the new slot", () => {
    const decision = rewriteDecision({ packExists: true, date: DATE, items: [row(1, "failed"), row(2, "pending")] });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe(REWRITE_FAILED_REASON);
  });

  it("counts posts, not rows, and says what a rewrite replaces", () => {
    const decision = rewriteDecision({
      packExists: true,
      date: DATE,
      pack,
      items: [
        row(1, "pending"), row(1, "pending", {}, "secondary"),
        row(2, "pending"), row(2, "pending", {}, "secondary"),
        row(3, "skipped"),
        row(0, "pending", { origin: "pipeline" })
      ]
    });
    expect(decision.allowed).toBe(true);
    expect(decision.counts).toMatchObject({ queued: 2, queuedSends: 4, skipped: 1, handAdded: 1 });
    expect(decision.replaces).toBe(5);
    const text = decision.confirm.join("\n");
    expect(text).toContain("2 queued posts (4 sends across accounts)");
    expect(text).toContain("1 skipped post");
    expect(text).toContain("edits or time changes you made to them are lost");
    expect(text).toContain("nothing is duplicated");
    expect(text).toContain("a sent post cannot be unsent");
    expect(text).toContain("1 post you added by hand is not touched");
  });

  it("does not repeat the number when there is one account", () => {
    const decision = rewriteDecision({ packExists: true, date: DATE, items: [row(1, "pending"), row(2, "pending")] });
    expect(decision.confirm.join(" ")).toContain("2 queued posts for today are replaced");
  });

  it("ignores other days and hand-added posts when deciding", () => {
    const decision = rewriteDecision({
      packExists: true,
      date: DATE,
      items: [
        row(1, "published", { postId: "yesterday", batchDate: "2026-10-10" }),
        row(0, "published", { origin: "pipeline", postId: "mine" })
      ]
    });
    expect(decision.allowed).toBe(true);
    expect(decision.counts.handAdded).toBe(1);
  });

  it("refuses to leave old copy queued behind a new pack when the autopilot cannot re-plan", () => {
    const items = [row(1, "pending")];
    const paused = rewriteDecision({ packExists: true, date: DATE, items, autopilot: { paused: true } });
    expect(paused.allowed).toBe(false);
    expect(paused.reason).toContain("paused");
    const blocked = rewriteDecision({ packExists: true, date: DATE, items, autopilot: { blockedReason: "No Threads account." } });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("No Threads account.");
    // Nothing queued means nothing to keep consistent, so a paused autopilot may still rewrite.
    expect(rewriteDecision({ packExists: true, date: DATE, items: [], autopilot: { paused: true } }).allowed).toBe(true);
  });

  it("puts 'started' ahead of every other reason", () => {
    const decision = rewriteDecision({
      packExists: true,
      date: DATE,
      items: [row(1, "published", { postId: "t1" }), row(2, "failed")],
      autopilot: { paused: true }
    });
    expect(decision.reason).toBe(REWRITE_STARTED_REASON);
  });
});
