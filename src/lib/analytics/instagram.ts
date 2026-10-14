import { classifyFailure, type HttpDeps } from "@/lib/analytics/http";
import { addNote, newOutcome, readEach, type FetchOutcome } from "@/lib/analytics/outcome";
import { pacedRequest, type Pacer } from "@/lib/analytics/pacing";
import { isParameterError } from "@/lib/analytics/params";
import type { FetchedPost, MetricValues } from "@/lib/analytics/types";

export type InstagramSession = { token: string; graphBase: string };

export const INSTAGRAM_SCOPE_NOTE =
  "Instagram reach, views and saves need the instagram_manage_insights permission; until Meta is reconnected with it, only likes and comments are read.";

const NAMES: Record<string, keyof MetricValues> = {
  views: "views",
  plays: "views",
  reach: "reach",
  likes: "likes",
  comments: "comments",
  shares: "shares",
  saved: "saves"
};

function graphMajor(graphBase: string): number | null {
  const match = /\/v(\d+)(?:\.\d+)?\/?$/.exec(graphBase);
  return match ? Number(match[1]) : null;
}

export function instagramMetricSets(graphBase: string): string[][] {
  const major = graphMajor(graphBase);
  const sets = [["views", "reach", "likes", "comments", "shares", "saved"]];
  if (major !== null && major < 22) sets.push(["plays", "reach", "likes", "comments", "shares", "saved"]);
  sets.push(["reach", "likes", "comments", "shares", "saved"]);
  return sets;
}

export function parseInstagramInsights(body: unknown): MetricValues {
  const metrics: MetricValues = {};
  const data = (body as { data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }> } | null)?.data;
  if (!Array.isArray(data)) return metrics;
  for (const entry of data) {
    const key = entry?.name ? NAMES[entry.name] : undefined;
    const value = entry?.values?.[0]?.value;
    if (!key || typeof value !== "number" || !Number.isFinite(value)) continue;
    if (entry.name === "plays" && metrics.views !== undefined) continue;
    metrics[key] = value;
  }
  return metrics;
}

export async function fetchInstagramMetrics(
  session: InstagramSession,
  mediaIds: string[],
  deps: HttpDeps = {},
  pacer?: Pacer
): Promise<FetchOutcome> {
  const outcome = newOutcome();
  const request = pacedRequest(pacer, deps);
  const sets = instagramMetricSets(session.graphBase);
  let setIndex = 0;
  let insightsAllowed = true;

  async function readInsights(id: string): Promise<MetricValues> {
    for (;;) {
      const query = new URLSearchParams({ metric: sets[setIndex].join(","), access_token: session.token });
      try {
        return parseInstagramInsights(
          await request(`${session.graphBase}/${encodeURIComponent(id)}/insights?${query}`, { label: "Instagram media insights" })
        );
      } catch (error) {
        if (!isParameterError(error)) throw error;
        if (setIndex >= sets.length - 1) throw error;
        setIndex += 1;
      }
    }
  }

  async function readBasic(id: string): Promise<MetricValues> {
    const query = new URLSearchParams({ fields: "like_count,comments_count", access_token: session.token });
    const body = await request<{ like_count?: unknown; comments_count?: unknown }>(
      `${session.graphBase}/${encodeURIComponent(id)}?${query}`,
      { label: "Instagram media" }
    );
    const metrics: MetricValues = {};
    if (typeof body.like_count === "number") metrics.likes = body.like_count;
    if (typeof body.comments_count === "number") metrics.comments = body.comments_count;
    return metrics;
  }

  await readEach(mediaIds, outcome, async (id): Promise<FetchedPost> => {
    if (insightsAllowed) {
      try {
        const metrics = await readInsights(id);
        if (Object.keys(metrics).length > 0) return { source: "instagram-insights", metrics };
      } catch (error) {
        if (classifyFailure(error).kind === "scope") {
          insightsAllowed = false;
          addNote(outcome, INSTAGRAM_SCOPE_NOTE);
        } else if (!isParameterError(error)) {
          throw error;
        }
      }
    }
    return { source: "instagram-basic", metrics: await readBasic(id) };
  });

  return outcome;
}
