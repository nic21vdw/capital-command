import { classifyFailure, requestJson, type HttpDeps } from "@/lib/analytics/http";
import { addNote, newOutcome, readEach, type FetchOutcome } from "@/lib/analytics/outcome";
import type { FetchedPost, MetricValues } from "@/lib/analytics/types";

export type InstagramSession = { token: string; graphBase: string };

export const INSTAGRAM_SCOPE_NOTE =
  "Instagram reach, views and saves need the instagram_manage_insights permission; until Meta is reconnected with it, only likes and comments are read.";

const METRIC_SETS = [
  ["views", "reach", "likes", "comments", "shares", "saved"],
  ["plays", "reach", "likes", "comments", "shares", "saved"],
  ["reach", "likes", "comments", "shares", "saved"]
];

const NAMES: Record<string, keyof MetricValues> = {
  views: "views",
  plays: "views",
  reach: "reach",
  likes: "likes",
  comments: "comments",
  shares: "shares",
  saved: "saves"
};

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

function isParameterError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return classifyFailure(error).kind === "other" && /\(HTTP 400\)/.test(message) && /"code"\s*:\s*100\b/.test(message);
}

async function readInsights(session: InstagramSession, id: string, deps: HttpDeps): Promise<MetricValues> {
  let last: unknown;
  for (const metrics of METRIC_SETS) {
    const query = new URLSearchParams({ metric: metrics.join(","), access_token: session.token });
    try {
      return parseInstagramInsights(
        await requestJson(`${session.graphBase}/${encodeURIComponent(id)}/insights?${query}`, { label: "Instagram media insights" }, deps)
      );
    } catch (error) {
      if (!isParameterError(error)) throw error;
      last = error;
    }
  }
  throw last;
}

async function readBasic(session: InstagramSession, id: string, deps: HttpDeps): Promise<MetricValues> {
  const query = new URLSearchParams({ fields: "like_count,comments_count", access_token: session.token });
  const body = await requestJson<{ like_count?: unknown; comments_count?: unknown }>(
    `${session.graphBase}/${encodeURIComponent(id)}?${query}`,
    { label: "Instagram media" },
    deps
  );
  const metrics: MetricValues = {};
  if (typeof body.like_count === "number") metrics.likes = body.like_count;
  if (typeof body.comments_count === "number") metrics.comments = body.comments_count;
  return metrics;
}

export async function fetchInstagramMetrics(session: InstagramSession, mediaIds: string[], deps: HttpDeps = {}): Promise<FetchOutcome> {
  const outcome = newOutcome();
  let insightsAllowed = true;

  await readEach(mediaIds, outcome, async (id): Promise<FetchedPost> => {
    if (insightsAllowed) {
      try {
        const metrics = await readInsights(session, id, deps);
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
    return { source: "instagram-basic", metrics: await readBasic(session, id, deps) };
  });

  return outcome;
}
