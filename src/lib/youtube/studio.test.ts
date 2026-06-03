import assert from "node:assert/strict";
import {
  MONETIZATION_SUBSCRIBERS,
  MONETIZATION_WATCH_HOURS,
  deriveStudioOverview,
  parseYouTubeVideoId,
  visibilityForStatus
} from "./studio";
import type { ContentItem, CreatorProfile } from "@/types/domain";

const NOW = new Date("2026-06-03T00:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function mkItem(input: Partial<ContentItem>): ContentItem {
  return {
    id: input.id ?? `c-${Math.random()}`,
    title: input.title ?? "Untitled",
    type: input.type ?? "Video",
    platform: input.platform ?? "YouTube",
    status: input.status ?? "Published",
    publishDate: input.publishDate,
    url: input.url ?? "",
    views: input.views,
    likes: input.likes,
    comments: input.comments,
    watchHours: input.watchHours,
    revenue: input.revenue,
    notes: input.notes ?? "",
    createdAt: input.createdAt ?? NOW.toISOString(),
    updatedAt: input.updatedAt ?? NOW.toISOString()
  };
}

function mkProfile(input: Partial<CreatorProfile>): CreatorProfile {
  return {
    channelName: input.channelName ?? "Test Channel",
    platform: input.platform ?? "YouTube",
    subscribers: input.subscribers ?? 0,
    totalViews: input.totalViews ?? 0,
    watchHours: input.watchHours ?? 0,
    monetized: input.monetized ?? false,
    subscriberGoal: input.subscriberGoal ?? 1000,
    monthlyRevenueGoal: input.monthlyRevenueGoal ?? 0,
    updatedAt: NOW.toISOString()
  };
}

// parseYouTubeVideoId handles the common URL shapes.
assert.equal(parseYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
assert.equal(parseYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
assert.equal(parseYouTubeVideoId("https://www.youtube.com/shorts/abc123XYZ_-"), "abc123XYZ_-");
assert.equal(parseYouTubeVideoId("https://youtube.com/live/streamId99"), "streamId99");
assert.equal(parseYouTubeVideoId("https://youtube.com"), null);
assert.equal(parseYouTubeVideoId(""), null);
assert.equal(parseYouTubeVideoId(undefined), null);
assert.equal(parseYouTubeVideoId("not a url"), null);

// visibilityForStatus maps the pipeline status onto Studio visibility.
assert.equal(visibilityForStatus("Published"), "Public");
assert.equal(visibilityForStatus("Scheduled"), "Scheduled");
assert.equal(visibilityForStatus("Idea"), "Draft");
assert.equal(visibilityForStatus("Editing"), "Draft");

// Only YouTube items appear, sorted newest-first by publish date.
{
  const overview = deriveStudioOverview(
    [
      mkItem({ id: "old", status: "Published", publishDate: daysAgo(40), views: 100 }),
      mkItem({ id: "new", status: "Published", publishDate: daysAgo(2), views: 100 }),
      mkItem({ id: "tiktok", platform: "TikTok", status: "Published", publishDate: daysAgo(1), views: 999 })
    ],
    mkProfile({}),
    { now: NOW }
  );
  assert.equal(overview.rows.length, 2);
  assert.equal(overview.rows[0].id, "new");
  assert.equal(overview.rows[1].id, "old");
  assert.equal(overview.publishedCount, 2);
}

// Top / under performers are judged against the channel median views.
{
  const overview = deriveStudioOverview(
    [
      mkItem({ id: "smash", status: "Published", publishDate: daysAgo(10), views: 10000, likes: 500, comments: 100 }),
      mkItem({ id: "mid-a", status: "Published", publishDate: daysAgo(9), views: 1000 }),
      mkItem({ id: "mid-b", status: "Published", publishDate: daysAgo(8), views: 1000 }),
      mkItem({ id: "flop", status: "Published", publishDate: daysAgo(7), views: 100 })
    ],
    mkProfile({}),
    { now: NOW }
  );
  assert.equal(overview.insights.medianViews, 1000);
  assert.deepEqual(
    overview.insights.topPerformers.map((row) => row.id),
    ["smash"]
  );
  assert.deepEqual(
    overview.insights.underPerformers.map((row) => row.id),
    ["flop"]
  );
  const smash = overview.rows.find((row) => row.id === "smash");
  assert.equal(smash?.performance, "top");
  assert.ok((smash?.engagementRate ?? 0) > 0);
}

// Too few published videos => no performance verdicts.
{
  const overview = deriveStudioOverview(
    [mkItem({ id: "only", status: "Published", publishDate: daysAgo(3), views: 500 })],
    mkProfile({}),
    { now: NOW }
  );
  assert.equal(overview.insights.topPerformers.length, 0);
  assert.equal(overview.insights.underPerformers.length, 0);
}

// Monetization: subscribers are the bottleneck, watch hours projected from cadence.
{
  const overview = deriveStudioOverview(
    [
      mkItem({ id: "a", status: "Published", publishDate: daysAgo(60), watchHours: 200, views: 100 }),
      mkItem({ id: "b", status: "Published", publishDate: daysAgo(30), watchHours: 200, views: 100 }),
      mkItem({ id: "c", status: "Published", publishDate: daysAgo(10), watchHours: 200, views: 100 })
    ],
    mkProfile({ subscribers: 200, watchHours: 3000 }),
    { now: NOW }
  );
  const m = overview.monetization;
  assert.equal(m.eligible, false);
  assert.equal(m.subscriberTarget, MONETIZATION_SUBSCRIBERS);
  assert.equal(m.watchHourTarget, MONETIZATION_WATCH_HOURS);
  assert.equal(m.subscribersRemaining, 800);
  assert.equal(m.watchHoursRemaining, 1000);
  // subscriberPct (20%) < watchHourPct (75%) => subscribers are further behind.
  assert.equal(m.bottleneck, "subscribers");
  assert.ok(m.uploadsPerMonth && m.uploadsPerMonth > 0);
  assert.equal(m.avgWatchHoursPerUpload, 200);
  assert.ok(m.projectedWatchHourDate, "expected a projected watch-hour date");
}

// Monetization: already eligible => no bottleneck, no projection.
{
  const overview = deriveStudioOverview([], mkProfile({ subscribers: 1500, watchHours: 5000, monetized: true }), {
    now: NOW
  });
  assert.equal(overview.monetization.eligible, true);
  assert.equal(overview.monetization.bottleneck, "none");
  assert.equal(overview.monetization.projectedWatchHourDate, null);
}

console.log("youtube/studio.test.ts passed");
