import { requestJson, type HttpDeps } from "@/lib/analytics/http";
import { addNote, newOutcome, readEach, type FetchOutcome } from "@/lib/analytics/outcome";
import type { FetchedPost, MetricValues } from "@/lib/analytics/types";

export type ThreadsSession = { token: string; base: string };

export const THREADS_SCOPE_NOTE =
  "Threads insights need the threads_manage_insights permission; reconnect Threads with it to see views, likes, replies and reposts.";

const METRICS = ["views", "likes", "replies", "reposts", "quotes", "shares"] as const;

export function parseThreadsInsights(body: unknown): MetricValues {
  const metrics: MetricValues = {};
  const data = (body as { data?: Array<{ name?: string; values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } }> } | null)?.data;
  if (!Array.isArray(data)) return metrics;
  for (const entry of data) {
    const name = METRICS.find((candidate) => candidate === entry?.name);
    const value = entry?.values?.[0]?.value ?? entry?.total_value?.value;
    if (name && typeof value === "number" && Number.isFinite(value)) metrics[name] = value;
  }
  return metrics;
}

export async function fetchThreadsMetrics(session: ThreadsSession, postIds: string[], deps: HttpDeps = {}): Promise<FetchOutcome> {
  const outcome = newOutcome();
  const query = new URLSearchParams({ metric: METRICS.join(",") });

  await readEach(postIds, outcome, async (id): Promise<FetchedPost> => {
    const body = await requestJson(
      `${session.base}/${encodeURIComponent(id)}/insights?${query}`,
      { label: "Threads insights", headers: { Authorization: `Bearer ${session.token}` } },
      deps
    );
    return { source: "threads-insights", metrics: parseThreadsInsights(body) };
  });

  if (outcome.stopped?.kind === "scope") addNote(outcome, THREADS_SCOPE_NOTE);
  return outcome;
}
