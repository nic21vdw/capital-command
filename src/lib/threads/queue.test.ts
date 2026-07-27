import { describe, expect, it } from "vitest";
import { threadsConfig, type ThreadsConfig } from "@/lib/threads/config";
import { hasBatch, pruneOld, summarizeBatch, summarizeBatches } from "@/lib/threads/queue";
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
