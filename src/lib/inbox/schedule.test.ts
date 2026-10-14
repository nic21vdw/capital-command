import { describe, expect, it } from "vitest";
import { pollIntervalMinutes, selectPostsToFetch } from "@/lib/inbox/schedule";
import { samplePost } from "@/lib/inbox/test-helpers";
import { cursorKey, type PostCursor } from "@/lib/inbox/types";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MIN = 60_000;

const at = (postId: string, publishedAgo: number) => samplePost({ postId, publishedAt: ago(publishedAgo) });
const cursors = (entries: Record<string, PostCursor>) =>
  Object.fromEntries(Object.entries(entries).map(([postId, cursor]) => [cursorKey("youtube", postId), cursor]));
const ids = (posts: { postId: string }[]) => posts.map((post) => post.postId);

describe("which posts are worth asking about", () => {
  it("covers posts from the last 30 days and nothing older", () => {
    const posts = [at("29d", 29 * DAY), at("31d", 31 * DAY), at("1h", HOUR)];
    expect(ids(selectPostsToFetch(posts, {}, NOW, { limit: 50 })).sort()).toEqual(["1h", "29d"]);
  });

  it("keeps an older post that still has recent activity", () => {
    const posts = [at("busy", 45 * DAY), at("quiet", 45 * DAY), at("stale-activity", 45 * DAY)];
    const known = cursors({
      busy: { lastActivityAt: ago(2 * DAY), lastFetchedAt: ago(2 * DAY) },
      "stale-activity": { lastActivityAt: ago(8 * DAY), lastFetchedAt: ago(2 * DAY) }
    });
    expect(ids(selectPostsToFetch(posts, known, NOW, { limit: 50 }))).toEqual(["busy"]);
  });

  it("skips a post that has not gone out yet", () => {
    const posts = [samplePost({ postId: "later", publishedAt: new Date(NOW.getTime() + HOUR).toISOString() })];
    expect(selectPostsToFetch(posts, {}, NOW, { limit: 50 })).toEqual([]);
  });
});

describe("how often each one is asked", () => {
  it("polls a fresh post every run and an old one about daily", () => {
    expect(pollIntervalMinutes(1)).toBe(25);
    expect(pollIntervalMinutes(10)).toBe(120);
    expect(pollIntervalMinutes(72)).toBe(720);
    expect(pollIntervalMinutes(20 * 24)).toBe(1440);
  });

  it.each([
    ["a new post fetched ten minutes ago", HOUR, 10 * MIN, false],
    ["a new post fetched half an hour ago", HOUR, 30 * MIN, true],
    ["a ten-hour-old post fetched an hour ago", 10 * HOUR, HOUR, false],
    ["a ten-hour-old post fetched over two hours ago", 10 * HOUR, 2 * HOUR + MIN, true],
    ["a three-day-old post fetched six hours ago", 3 * DAY, 6 * HOUR, false],
    ["a three-day-old post fetched thirteen hours ago", 3 * DAY, 13 * HOUR, true],
    ["a three-week-old post fetched twenty-three hours ago", 20 * DAY, 23 * HOUR, false],
    ["a three-week-old post fetched a day and an hour ago", 20 * DAY, 25 * HOUR, true]
  ])("treats %s correctly", (_name, publishedAgo, fetchedAgo, due) => {
    const known = cursors({ p: { lastFetchedAt: ago(fetchedAgo) } });
    expect(ids(selectPostsToFetch([at("p", publishedAgo)], known, NOW, { limit: 5 }))).toEqual(due ? ["p"] : []);
  });

  it("asks a quiet old post again quickly once someone has just commented on it", () => {
    const known = cursors({ p: { lastFetchedAt: ago(30 * MIN), lastActivityAt: ago(HOUR) } });
    expect(ids(selectPostsToFetch([at("p", 20 * DAY)], known, NOW, { limit: 5 }))).toEqual(["p"]);
  });

  it("puts never-fetched posts first, then the stalest, and honours the limit", () => {
    const posts = [at("fresh", HOUR), at("never", 2 * HOUR), at("stale", 3 * HOUR)];
    const known = cursors({ fresh: { lastFetchedAt: ago(40 * MIN) }, stale: { lastFetchedAt: ago(5 * HOUR) } });
    expect(ids(selectPostsToFetch(posts, known, NOW, { limit: 2 }))).toEqual(["never", "stale"]);
  });

  it("ignores the interval when forced, but not the 30-day window", () => {
    const posts = [at("just-fetched", HOUR), at("ancient", 60 * DAY)];
    const known = cursors({ "just-fetched": { lastFetchedAt: ago(MIN) } });
    expect(ids(selectPostsToFetch(posts, known, NOW, { limit: 5, force: true }))).toEqual(["just-fetched"]);
  });
});
