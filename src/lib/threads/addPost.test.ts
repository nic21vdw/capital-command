import { describe, expect, it } from "vitest";
import { planAddedPost } from "@/lib/threads/addPost";
import { THREADS_TEXT_LIMIT, type ThreadsConfig } from "@/lib/threads/config";

const config = {
  enabled: true,
  timezone: "America/Toronto",
  postsPerDay: 6,
  plugReplies: false,
  accounts: [{ id: "main", label: "Main", userId: "u", accessToken: "t", posts: "text", offsetMinutes: 0 }]
} as unknown as ThreadsConfig;
const now = new Date("2026-10-10T14:00:00.000Z");
const plan = (text: string | undefined, at?: string, over: Partial<ThreadsConfig> = {}) =>
  planAddedPost({ text, at, config: { ...config, ...over }, now, taken: new Set(), newId: () => "added-1" });

describe("adding a hand-written Threads post", () => {
  it("queues one pending post about two hours out when no time is given", () => {
    const result = plan("  Ship the boring thing first.  ");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item).toMatchObject({ id: "added-1", text: "Ship the boring thing first.", status: "pending", accountId: "main", slot: 0, origin: "pipeline" });
    expect(result.item.publishAt).toBe("2026-10-10T16:00:00.000Z");
  });

  it("posts at exactly the time asked for", () => {
    const result = plan("Hello", "2026-10-11T13:07:00.000Z");
    expect(result.ok && result.item.publishAt).toBe("2026-10-11T13:07:00.000Z");
    expect(result.ok && result.item.batchDate).toBe("2026-10-11");
  });

  it("refuses empty text, text over Threads' limit and nothing else about the wording", () => {
    expect(plan("   ")).toEqual({ ok: false, error: "Write the post first." });
    expect(plan(undefined).ok).toBe(false);
    expect(plan("a".repeat(THREADS_TEXT_LIMIT)).ok).toBe(true);
    const long = plan("a".repeat(THREADS_TEXT_LIMIT + 3));
    expect(long).toMatchObject({ ok: false });
    expect(!long.ok && long.error).toContain("Shorten it by 3");
  });

  it("refuses times in the past, invalid times and times too far out", () => {
    expect(plan("Hi", "2026-10-10T14:00:30.000Z")).toMatchObject({ ok: false });
    expect(plan("Hi", "2026-10-09T10:00:00.000Z")).toMatchObject({ ok: false });
    expect(plan("Hi", "not a time")).toMatchObject({ ok: false, error: "That time is not valid." });
    expect(plan("Hi", "2027-03-01T10:00:00.000Z")).toMatchObject({ ok: false });
  });

  it("explains when there is no account to post from", () => {
    const result = plan("Hi", undefined, { accounts: [] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("No Threads account");
  });
});
