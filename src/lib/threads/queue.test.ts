import { describe, expect, it } from "vitest";
import { threadsConfig, type ThreadsConfig } from "@/lib/threads/config";
import {
  editItemText,
  hasBatch,
  pruneOld,
  rescheduleItem,
  retryItem,
  shiftBatch,
  summarizeBatch,
  summarizeBatches
} from "@/lib/threads/queue";
import type { ThreadsQueueItem } from "@/lib/threads/types";

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

const config: ThreadsConfig = { ...threadsConfig(), retentionDays: 14 };

describe("pruneOld", () => {
  it("keeps recent batches and drops ones past the retention window", () => {
    const kept = pruneOld(
      [
        item({ id: "old", batchDate: "2026-07-01", publishAt: "2026-07-01T07:15:00.000Z" }),
        item({ id: "recent" })
      ],
      new Date("2026-07-23T00:00:00.000Z"),
      config
    );

    expect(kept.map((entry) => entry.id)).toEqual(["recent"]);
  });
});

describe("hasBatch", () => {
  it("reports whether a day is already scheduled", () => {
    expect(hasBatch([item()], "2026-07-22")).toBe(true);
    expect(hasBatch([item()], "2026-07-23")).toBe(false);
  });
});

describe("summarizeBatch", () => {
  it("counts each state and points at the next post still to go", () => {
    const summary = summarizeBatch(
      [
        item({ id: "a", status: "published" }),
        item({ id: "b", publishAt: "2026-07-22T12:00:00.000Z" }),
        item({ id: "c", publishAt: "2026-07-22T09:00:00.000Z" }),
        item({ id: "d", status: "failed" }),
        item({ id: "e", status: "skipped" }),
        item({ id: "f", batchDate: "2026-07-23" })
      ],
      "2026-07-22"
    );

    expect(summary).toMatchObject({
      date: "2026-07-22",
      total: 5,
      published: 1,
      pending: 2,
      failed: 1,
      skipped: 1,
      nextAt: "2026-07-22T09:00:00.000Z"
    });
  });

  it("returns an empty tally for a day with nothing scheduled", () => {
    expect(summarizeBatch([], "2026-07-22")).toMatchObject({ total: 0, pending: 0, nextAt: undefined, accounts: [] });
  });

  it("breaks the day down per account, so one account stalling is visible", () => {
    const summary = summarizeBatch(
      [
        item({ id: "a", accountId: "primary", status: "published" }),
        item({ id: "b", accountId: "primary", status: "published" }),
        item({ id: "c", accountId: "secondary", status: "failed" }),
        item({ id: "d", accountId: "secondary" })
      ],
      "2026-07-22"
    );

    expect(summary.accounts).toEqual([
      { accountId: "primary", total: 2, published: 2, pending: 0, failed: 0, skipped: 0 },
      { accountId: "secondary", total: 2, published: 0, pending: 1, failed: 1, skipped: 0 }
    ]);
  });
});

describe("summarizeBatches", () => {
  it("lists every scheduled day, newest first", () => {
    const batches = summarizeBatches([
      item({ id: "a", batchDate: "2026-07-21" }),
      item({ id: "b", batchDate: "2026-07-23" }),
      item({ id: "c", batchDate: "2026-07-22" })
    ]);

    expect(batches.map((batch) => batch.date)).toEqual(["2026-07-23", "2026-07-22", "2026-07-21"]);
  });
});

describe("rescheduleItem", () => {
  it("moves a pending post and clears the gates set for its old time", () => {
    const items = [item({ nextAttemptAt: "2026-07-22T07:20:00.000Z", claimedAt: "2026-07-22T07:16:00.000Z" })];

    const result = rescheduleItem(items, "item-1", "2026-07-22T18:00:00.000Z");

    expect(result.changed).toBe(1);
    expect(items[0].publishAt).toBe("2026-07-22T18:00:00.000Z");
    expect(items[0].nextAttemptAt).toBeUndefined();
    expect(items[0].claimedAt).toBeUndefined();
  });

  it("refuses to move a post that already went out", () => {
    const items = [item({ status: "published" })];

    const result = rescheduleItem(items, "item-1", "2026-07-22T18:00:00.000Z");

    expect(result.changed).toBe(0);
    expect(result.error).toContain("already published");
    expect(items[0].publishAt).toBe("2026-07-22T07:15:00.000Z");
  });

  it("rejects an unparseable time and an unknown post", () => {
    expect(rescheduleItem([item()], "item-1", "half past tuesday").error).toContain("valid time");
    expect(rescheduleItem([item()], "nope", "2026-07-22T18:00:00.000Z").error).toContain("No such");
  });
});

describe("shiftBatch", () => {
  it("moves every pending post of the day and leaves the rest alone", () => {
    const items = [
      item({ id: "a" }),
      item({ id: "b", publishAt: "2026-07-22T09:00:00.000Z" }),
      item({ id: "c", status: "published" }),
      item({ id: "d", batchDate: "2026-07-23", publishAt: "2026-07-23T07:15:00.000Z" })
    ];

    const result = shiftBatch(items, "2026-07-22", 30);

    expect(result.changed).toBe(2);
    expect(items[0].publishAt).toBe("2026-07-22T07:45:00.000Z");
    expect(items[1].publishAt).toBe("2026-07-22T09:30:00.000Z");
    expect(items[2].publishAt).toBe("2026-07-22T07:15:00.000Z");
    expect(items[3].publishAt).toBe("2026-07-23T07:15:00.000Z");
  });

  it("moves a batch earlier on a negative shift", () => {
    const items = [item()];
    shiftBatch(items, "2026-07-22", -45);
    expect(items[0].publishAt).toBe("2026-07-22T06:30:00.000Z");
  });

  it("says so when there is nothing pending to move", () => {
    expect(shiftBatch([item({ status: "published" })], "2026-07-22", 30).error).toContain("Nothing pending");
    expect(shiftBatch([item()], "2026-07-22", 0).error).toContain("non-zero");
  });
});

describe("editItemText", () => {
  it("rewrites a pending post", () => {
    const items = [item()];
    expect(editItemText(items, "item-1", "  a better line  ").changed).toBe(1);
    expect(items[0].text).toBe("a better line");
  });

  it("holds the text to the Threads limit", () => {
    const items = [item()];
    editItemText(items, "item-1", "x".repeat(600));
    expect(items[0].text).toHaveLength(500);
  });

  it("refuses an empty post or one that already went out", () => {
    expect(editItemText([item()], "item-1", "   ").error).toContain("can't be empty");
    expect(editItemText([item({ status: "published" })], "item-1", "new").error).toContain("already published");
  });

  it("still opens the copy of a failed post, which is on its way to a retry", () => {
    const items = [item({ status: "failed", error: "token expired" })];
    expect(editItemText(items, "item-1", "fixed line").changed).toBe(1);
    expect(items[0].text).toBe("fixed line");
  });
});

describe("retryItem", () => {
  const now = new Date("2026-07-22T09:00:00.000Z");

  it("puts a failed post back in the running at this moment, without its failure", () => {
    const items = [
      item({ status: "failed", error: "Threads rejected it", attempts: 3, nextAttemptAt: "x", claimedAt: "y" })
    ];

    expect(retryItem(items, "item-1", now).changed).toBe(1);
    expect(items[0].status).toBe("pending");
    expect(items[0].attempts).toBe(0);
    expect(items[0].error).toBeUndefined();
    expect(items[0].nextAttemptAt).toBeUndefined();
    expect(items[0].claimedAt).toBeUndefined();
    // Its old slot is long past, and the runner skips anything that late.
    expect(items[0].publishAt).toBe(now.toISOString());
  });

  it("recovers a skipped post too, and keeps a slot that is still ahead", () => {
    const later = "2026-07-22T19:30:00.000Z";
    const items = [item({ status: "skipped", note: "missed its slot", publishAt: later })];

    expect(retryItem(items, "item-1", now).changed).toBe(1);
    expect(items[0].status).toBe("pending");
    expect(items[0].note).toBeUndefined();
    expect(items[0].publishAt).toBe(later);
  });

  it("refuses a post that is published or already queued", () => {
    expect(retryItem([item({ status: "published" })], "item-1", now).error).toContain("published");
    expect(retryItem([item()], "item-1", now).error).toContain("pending");
    expect(retryItem([item()], "nope", now).error).toContain("No such");
  });
});
