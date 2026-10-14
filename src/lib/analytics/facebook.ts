import { classifyFailure, type HttpDeps } from "@/lib/analytics/http";
import { createLadder, type Ladder } from "@/lib/analytics/ladder";
import { addNote, newOutcome, readEach, type FetchOutcome } from "@/lib/analytics/outcome";
import { pacedRequest, type Pacer } from "@/lib/analytics/pacing";
import { isParameterError } from "@/lib/analytics/params";
import type { FetchedPost, MetricValues, PostFormat } from "@/lib/analytics/types";

export type FacebookSession = { token: string; graphBase: string };

export type FacebookNode = "video" | "photo" | "post";

export type FacebookPost = { id: string; node: FacebookNode };

export const FACEBOOK_SCOPE_NOTE =
  "Facebook views and watch time need the read_insights permission; until the Page token is reconnected with it, only reactions, comments and shares are read.";

const INSIGHT_SETS: Record<FacebookNode, string[][]> = {
  video: [
    ["blue_reels_play_count", "post_video_avg_time_watched", "post_video_view_time"],
    ["fb_reels_total_plays", "post_video_avg_time_watched", "post_video_view_time"],
    ["total_video_views", "total_video_avg_time_watched", "total_video_view_total_time"]
  ],
  post: [["post_media_view"]],
  photo: []
};

const INSIGHT_EDGE: Record<FacebookNode, string> = { video: "video_insights", post: "insights", photo: "insights" };

const REACTIONS = "reactions.summary(true).limit(0)";
const LIKES = "likes.summary(true).limit(0)";
const COMMENTS = "comments.summary(true).limit(0)";

const FIELD_LISTS: Record<FacebookNode, string[]> = {
  video: [`${LIKES},${COMMENTS}`, `${REACTIONS},${COMMENTS}`],
  photo: [`${REACTIONS},${COMMENTS}`, `${LIKES},${COMMENTS}`],
  post: [`${REACTIONS},${COMMENTS},shares`, `${REACTIONS},${COMMENTS}`]
};

export function facebookNodeOf(target: { postId: string; format: PostFormat }): FacebookNode {
  if (target.format === "video" || target.format === "long-form") return "video";
  if (target.format === "carousel" || target.postId.includes("_")) return "post";
  return "photo";
}

export function parseFacebookInsights(body: unknown): MetricValues {
  const metrics: MetricValues = {};
  const data = (body as { data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }> } | null)?.data;
  if (!Array.isArray(data)) return metrics;
  for (const entry of data) {
    const value = entry?.values?.[0]?.value;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    switch (entry.name) {
      case "blue_reels_play_count":
      case "fb_reels_total_plays":
      case "total_video_views":
      case "post_video_views":
      case "post_media_view":
        metrics.views = metrics.views ?? value;
        break;
      case "total_video_avg_time_watched":
      case "post_video_avg_time_watched":
        metrics.avgViewSeconds = value / 1000;
        break;
      case "total_video_view_total_time":
      case "post_video_view_time":
      case "fb_reels_video_view_total_time":
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

export async function fetchFacebookMetrics(
  session: FacebookSession,
  posts: FacebookPost[],
  deps: HttpDeps = {},
  pacer?: Pacer
): Promise<FetchOutcome> {
  const outcome = newOutcome();
  const request = pacedRequest(pacer, deps);
  const byId = new Map(posts.map((post) => [post.id, post]));
  const insightLadders = new Map<FacebookNode, Ladder>();
  const fieldLadders = new Map<FacebookNode, Ladder>();
  const ladderOf = (ladders: Map<FacebookNode, Ladder>, node: FacebookNode, size: number) => {
    let ladder = ladders.get(node);
    if (!ladder) {
      ladder = createLadder(size);
      ladders.set(node, ladder);
    }
    return ladder;
  };
  let insightsAllowed = true;

  async function readInsights(post: FacebookPost): Promise<MetricValues> {
    const sets = INSIGHT_SETS[post.node];
    if (!insightsAllowed || sets.length === 0) return {};
    const ladder = ladderOf(insightLadders, post.node, sets.length);
    if (ladder.exhausted(post.node)) return {};
    let index = ladder.start(post.node);
    for (;;) {
      const query = new URLSearchParams({ metric: sets[index].join(","), access_token: session.token });
      try {
        const metrics = parseFacebookInsights(
          await request(`${session.graphBase}/${encodeURIComponent(post.id)}/${INSIGHT_EDGE[post.node]}?${query}`, { label: "Facebook insights" })
        );
        ladder.accepted(post.node, index);
        return metrics;
      } catch (error) {
        if (classifyFailure(error).kind === "scope") {
          insightsAllowed = false;
          addNote(outcome, FACEBOOK_SCOPE_NOTE);
          return {};
        }
        if (!isParameterError(error)) throw error;
        ladder.refused(post.node, index, post.id);
        if (index >= sets.length - 1) return {};
        index += 1;
      }
    }
  }

  async function readBasic(post: FacebookPost): Promise<MetricValues> {
    const lists = FIELD_LISTS[post.node];
    const ladder = ladderOf(fieldLadders, post.node, lists.length);
    let index = ladder.start(post.node);
    for (;;) {
      const query = new URLSearchParams({ fields: lists[index], access_token: session.token });
      try {
        const metrics = parseFacebookBasic(await request(`${session.graphBase}/${encodeURIComponent(post.id)}?${query}`, { label: "Facebook post" }));
        ladder.accepted(post.node, index);
        return metrics;
      } catch (error) {
        if (!isParameterError(error)) throw error;
        ladder.refused(post.node, index, post.id);
        if (index >= lists.length - 1) throw error;
        index += 1;
      }
    }
  }

  await readEach(
    posts.map((post) => post.id),
    outcome,
    async (id): Promise<FetchedPost> => {
      const post = byId.get(id)!;
      const insights = await readInsights(post);
      const basic = await readBasic(post);
      const metrics = { ...insights, ...basic };
      if (Object.keys(metrics).length === 0) throw new Error(`Facebook returned no numbers for post ${id}.`);
      return { source: Object.keys(insights).length > 0 ? "facebook-insights" : "facebook-basic", metrics };
    }
  );

  return outcome;
}
