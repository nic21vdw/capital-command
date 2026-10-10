import { describe, expect, it } from "vitest";
import {
  ATTENTION_WINDOW_DAYS,
  MAX_FAILURES_LISTED,
  attentionSummary,
  describeBreakdown,
  publishFailures,
  threadsFailures
} from "@/lib/attention/failures";
import { buildNotifyMessage } from "@/lib/colateral/protocol";
import type { QueueItem } from "@/lib/publisher/types";
import type { ThreadsQueueItem } from "@/lib/threads/types";

const NOW = new Date("2026-10-10T15:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const post = (over: Partial<QueueItem>): QueueItem =>
  ({
    id: "q1",
    clipPath: "data/clips/outputs/job1/clip-1.mp4",
    title: "Stream highlight",
    caption: "",
    hashtags: [],
    publishAt: daysAgo(1),
    visibility: "public",
    createdAt: daysAgo(3),
    platforms: { youtube: { status: "published", postId: "abc", attempts: 1 } },
    ...over
  }) as QueueItem;

const thread = (over: Partial<ThreadsQueueItem>): ThreadsQueueItem => ({
  id: "t1",
  batchDate: "2026-10-09",
  slot: 1,
  accountId: "a",
  version: "text",
  topic: "Why I stream",
  format: "hot-take",
  text: "text",
  publishAt: daysAgo(1),
  status: "failed",
  error: "400 bad request",
  attempts: 3,
  createdAt: daysAgo(2),
  ...over
});

const summary = (queue: QueueItem[], threadsItems: ThreadsQueueItem[] = [], pipeline = 0) =>
  attentionSummary({ pipeline, queue, threadsItems, now: NOW });

describe("publish failures in the attention count", () => {
  it("counts a post with ANY failed leg, not only one where every leg failed", () => {
    const partly = post({
      platforms: {
        youtube: { status: "published", postId: "abc", attempts: 1 },
        instagram: { status: "failed", error: "rejected", attempts: 3 }
      }
    });
    expect(summary([partly]).breakdown).toEqual({ pipeline: 0, publish: 1, threads: 0 });
  });

  it("counts one post once however many legs failed", () => {
    const both = post({
      platforms: { youtube: { status: "failed", attempts: 3 }, tiktok: { status: "failed", attempts: 3 } }
    });
    const result = summary([both]);
    expect(result.breakdown.publish).toBe(1);
    expect(result.failures).toHaveLength(2);
  });

  it("ignores healthy, waiting and manual posts", () => {
    const result = summary([
      post({ id: "ok" }),
      post({ id: "wait", platforms: { youtube: { status: "pending", attempts: 0 } } }),
      post({ id: "hand", platforms: { tiktok: { status: "manual", attempts: 0 } } })
    ]);
    expect(result.breakdown.publish).toBe(0);
  });

  it("stops counting a fully failed post once the board has shown it", () => {
    const failed = post({ platforms: { youtube: { status: "failed", attempts: 3 } } });
    expect(summary([failed]).breakdown.publish).toBe(1);
    expect(summary([{ ...failed, failedSeenAt: daysAgo(0) }]).breakdown.publish).toBe(0);
  });

  it("keeps counting a partly failed post, which the board never stamps as seen", () => {
    const partly = post({
      failedSeenAt: daysAgo(0),
      platforms: { youtube: { status: "published", attempts: 1 }, tiktok: { status: "failed", attempts: 3 } }
    });
    expect(summary([partly]).breakdown.publish).toBe(1);
  });

  it("only looks back a week by slot, and counts a failed upload ahead of its slot", () => {
    const failedLeg = { youtube: { status: "failed" as const, attempts: 3 } };
    expect(summary([post({ publishAt: daysAgo(ATTENTION_WINDOW_DAYS + 1), platforms: failedLeg })]).breakdown.publish).toBe(0);
    expect(summary([post({ publishAt: daysAgo(ATTENTION_WINDOW_DAYS - 1), platforms: failedLeg })]).breakdown.publish).toBe(1);
    expect(summary([post({ publishAt: daysAgo(-2), platforms: failedLeg })]).breakdown.publish).toBe(1);
  });

  it("counts a failed Buffer hand-off", () => {
    expect(summary([post({ buffer: { status: "failed", attempts: 3 } })]).breakdown.publish).toBe(1);
  });
});

describe("Threads failures in the attention count", () => {
  it("counts failed posts inside the window only", () => {
    const result = summary([], [
      thread({ id: "a" }),
      thread({ id: "old", publishAt: daysAgo(20) }),
      thread({ id: "sent", status: "published" }),
      thread({ id: "skipped", status: "skipped" }),
      thread({ id: "wait", status: "pending" })
    ]);
    expect(result.breakdown.threads).toBe(1);
  });
});

describe("the breakdown", () => {
  it("adds up to the number the badge and window title show", () => {
    const result = summary(
      [post({ platforms: { youtube: { status: "failed", attempts: 3 } } })],
      [thread({ id: "a" }), thread({ id: "b", slot: 2 })],
      2
    );
    expect(result.breakdown).toEqual({ pipeline: 2, publish: 1, threads: 2 });
    expect(result.needsAttention).toBe(5);
  });

  it("explains itself in words", () => {
    expect(describeBreakdown({ pipeline: 2, publish: 1, threads: 3 })).toBe(
      "2 stream issues, 1 failed post, 3 failed Threads posts"
    );
    expect(describeBreakdown({ pipeline: 0, publish: 0, threads: 0 })).toBe("");
  });
});

describe("the notifications for failures", () => {
  it("names the platform, gives plain advice, and points at the post", () => {
    const [failure] = publishFailures(
      [post({ platforms: { youtube: { status: "failed", error: "quota exceeded", attempts: 2 } } })],
      NOW
    );
    expect(failure.title).toBe("A YouTube post failed");
    expect(failure.body).toContain("Stream highlight");
    expect(failure.body).toContain("retry");
    expect(failure.body).not.toContain("quota exceeded");
    expect(failure.route).toBe("/uploading-center?item=q1&platform=youtube");
    expect(failure.level).toBe("error");
  });

  it("tells a connection failure to reconnect rather than retry", () => {
    const [failure] = publishFailures(
      [post({ platforms: { instagram: { status: "failed", error: "invalid_grant", attempts: 1 } } })],
      NOW
    );
    expect(failure.body).toContain("Reconnect");
  });

  it("gives each failure an id that is stable for the event and new for the next one", () => {
    const failed = (attempts: number) =>
      post({ platforms: { youtube: { status: "failed", attempts } } });
    const first = publishFailures([failed(2)], NOW)[0].id;
    expect(publishFailures([failed(2)], NOW)[0].id).toBe(first);
    expect(publishFailures([failed(3)], NOW)[0].id).not.toBe(first);
    expect(first).toBe("publish-failed:q1:youtube:2");
  });

  it("sends Threads failures to the Threads page", () => {
    const [failure] = threadsFailures([thread({})], NOW);
    expect(failure.title).toBe("A Threads post failed");
    expect(failure.route).toBe("/x-posts");
    expect(failure.id).toBe("threads-failed:t1:3");
  });

  it("builds valid protocol messages", () => {
    const { failures } = summary(
      [post({ platforms: { youtube: { status: "failed", attempts: 1 } } })],
      [thread({})]
    );
    expect(failures).toHaveLength(2);
    for (const failure of failures) {
      const message = buildNotifyMessage(failure);
      expect(message).not.toBeNull();
      expect(message?.notification.route).toBe(failure.route);
    }
  });

  it("lists at most a handful, newest first", () => {
    const queue = Array.from({ length: 15 }, (_, index) =>
      post({ id: `q${index}`, publishAt: daysAgo(index / 10), platforms: { youtube: { status: "failed", attempts: 1 } } })
    );
    const { failures, breakdown } = summary(queue);
    expect(breakdown.publish).toBe(15);
    expect(failures).toHaveLength(MAX_FAILURES_LISTED);
    expect(failures[0].id).toContain("q0");
  });
});
