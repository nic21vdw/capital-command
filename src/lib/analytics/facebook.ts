import { classifyFailure, requestJson, type HttpDeps } from "@/lib/analytics/http";
import { addNote, newOutcome, readEach, type FetchOutcome } from "@/lib/analytics/outcome";
import type { FetchedPost, MetricValues } from "@/lib/analytics/types";

export type FacebookSession = { token: string; graphBase: string };

export type FacebookPost = { id: string; image: boolean };

export const FACEBOOK_SCOPE_NOTE =
  "Facebook views and watch time need the read_insights permission; until the Page token is reconnected with it, only reactions, comments and shares are read.";

const VIDEO_METRIC_SETS = [
  ["total_video_views", "total_video_avg_time_watched", "total_video_view_total_time"],
  ["post_video_views", "post_video_avg_time_watched", "post_video_view_time"]
];

const POST_METRIC_SETS = [["post_media_view"]];

export function parseFacebookInsights(body: unknown): MetricValues {
  const metrics: MetricValues = {};
  const data = (body as { data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }> } | null)?.data;
  if (!Array.isArray(data)) return metrics;
  for (const entry of data) {
    const value = entry?.values?.[0]?.value;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    switch (entry.name) {
      case "total_video_views":
      case "post_video_views":
      case "post_media_view":
        metrics.views = value;
        break;
      case "total_video_avg_time_watched":
      case "post_video_avg_time_watched":
        metrics.avgViewSeconds = value / 1000;
        break;
      case "total_video_view_total_time":
      case "post_video_view_time":
        metrics.watchMinutes = value / 60_000;
        break;
    }
  }
  return metrics;
}

function summaryCount(node: unknown): number | undefined {
  const total = (node as { summary?: { total_count?: unknown } } | undefined)?.summary?.total_count;
  return typeof total === "number" && Number.isFinite(total) ? total : undefined;
}

export function parseFacebookBasic(body: unknown): MetricValues {
  const node = (body ?? {}) as { reactions?: unknown; likes?: unknown; comments?: unknown; shares?: { count?: unknown } };
  const metrics: MetricValues = {};
  const likes = summaryCount(node.reactions) ?? summaryCount(node.likes);
  const comments = summaryCount(node.comments);
  const shares = node.shares?.count;
  if (likes !== undefined) metrics.likes = likes;
  if (comments !== undefined) metrics.comments = comments;
  if (typeof shares === "number" && Number.isFinite(shares)) metrics.shares = shares;
  return metrics;
}

function isParameterError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return classifyFailure(error).kind === "other" && /\(HTTP 400\)/.test(message) && /"code"\s*:\s*100\b/.test(message);
}

async function readInsights(session: FacebookSession, post: FacebookPost, deps: HttpDeps): Promise<MetricValues> {
  const sets = post.image ? POST_METRIC_SETS : VIDEO_METRIC_SETS;
  const edge = post.image ? "insights" : "video_insights";
  let last: unknown;
  for (const metrics of sets) {
    const query = new URLSearchParams({ metric: metrics.join(","), access_token: session.token });
    try {
      return parseFacebookInsights(
        await requestJson(`${session.graphBase}/${encodeURIComponent(post.id)}/${edge}?${query}`, { label: "Facebook insights" }, deps)
      );
    } catch (error) {
      if (!isParameterError(error)) throw error;
      last = error;
    }
  }
  throw last;
}

async function readBasic(session: FacebookSession, post: FacebookPost, deps: HttpDeps): Promise<MetricValues> {
  const fields = post.image
    ? "reactions.summary(true).limit(0),comments.summary(true).limit(0),shares"
    : "likes.summary(true).limit(0),comments.summary(true).limit(0)";
  const query = new URLSearchParams({ fields, access_token: session.token });
  return parseFacebookBasic(
    await requestJson(`${session.graphBase}/${encodeURIComponent(post.id)}?${query}`, { label: "Facebook post" }, deps)
  );
}

export async function fetchFacebookMetrics(
  session: FacebookSession,
  posts: FacebookPost[],
  deps: HttpDeps = {}
): Promise<FetchOutcome> {
  const outcome = newOutcome();
  const byId = new Map(posts.map((post) => [post.id, post]));
  let insightsAllowed = true;

  await readEach(
    posts.map((post) => post.id),
    outcome,
    async (id): Promise<FetchedPost> => {
      const post = byId.get(id)!;
      let insights: MetricValues = {};
      if (insightsAllowed) {
        try {
          insights = await readInsights(session, post, deps);
        } catch (error) {
          if (classifyFailure(error).kind === "scope") {
            insightsAllowed = false;
            addNote(outcome, FACEBOOK_SCOPE_NOTE);
          } else if (!isParameterError(error)) {
            throw error;
          }
        }
      }
      const basic = await readBasic(session, post, deps);
      const metrics = { ...insights, ...basic };
      if (Object.keys(metrics).length === 0) throw new Error(`Facebook returned no numbers for post ${id}.`);
      return { source: Object.keys(insights).length > 0 ? "facebook-insights" : "facebook-basic", metrics };
    }
  );

  return outcome;
}
