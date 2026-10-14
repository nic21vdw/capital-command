import type { HttpDeps } from "@/lib/analytics/http";
import { createLadder } from "@/lib/analytics/ladder";
import { addNote, newOutcome, readEach, type FetchOutcome } from "@/lib/analytics/outcome";
import { pacedRequest, type Pacer } from "@/lib/analytics/pacing";
import { isParameterError } from "@/lib/analytics/params";
import type { FetchedPost, MetricValues } from "@/lib/analytics/types";

export type ThreadsSession = { token: string; base: string };

export type ThreadsPost = { id: string; kind: string };

export const THREADS_SCOPE_NOTE =
  "Threads insights need the threads_manage_insights permission; reconnect Threads with it to see views, likes, replies and reposts.";

const METRIC_SETS = [
  ["views", "likes", "replies", "reposts", "quotes", "shares"],
  ["views", "likes", "replies", "reposts", "quotes"],
  ["views", "likes"]
];

const KNOWN = new Set(METRIC_SETS[0]);

export function parseThreadsInsights(body: unknown): MetricValues {
  const metrics: MetricValues = {};
  const data = (body as { data?: Array<{ name?: string; values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } }> } | null)?.data;
  if (!Array.isArray(data)) return metrics;
  for (const entry of data) {
    const name = entry?.name;
    const value = entry?.values?.[0]?.value ?? entry?.total_value?.value;
    if (name && KNOWN.has(name) && typeof value === "number" && Number.isFinite(value)) metrics[name as keyof MetricValues] = value;
  }
  return metrics;
}

export async function fetchThreadsMetrics(
  session: ThreadsSession,
  posts: ThreadsPost[],
  deps: HttpDeps = {},
  pacer?: Pacer
): Promise<FetchOutcome> {
  const outcome = newOutcome();
  const request = pacedRequest(pacer, deps);
  const ladder = createLadder(METRIC_SETS.length);
  const kindOf = new Map(posts.map((post) => [post.id, post.kind]));

  await readEach(
    posts.map((post) => post.id),
    outcome,
    async (id): Promise<FetchedPost> => {
      const kind = kindOf.get(id) ?? "TEXT";
      let index = ladder.start(kind);
      for (;;) {
        const query = new URLSearchParams({ metric: METRIC_SETS[index].join(",") });
        try {
          const body = await request(`${session.base}/${encodeURIComponent(id)}/insights?${query}`, {
            label: "Threads insights",
            headers: { Authorization: `Bearer ${session.token}` }
          });
          ladder.accepted(kind, index);
          return { source: "threads-insights", metrics: parseThreadsInsights(body) };
        } catch (error) {
          if (!isParameterError(error)) throw error;
          ladder.refused(kind, index, id);
          if (index >= METRIC_SETS.length - 1) throw error;
          index += 1;
        }
      }
    }
  );

  if (outcome.stopped?.kind === "scope") addNote(outcome, THREADS_SCOPE_NOTE);
  return outcome;
}
