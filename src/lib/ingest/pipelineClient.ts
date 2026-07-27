import type { PipelineRunOverview } from "@/lib/pipeline/types";

/**
 * Hands a stream to the Stream Pipeline and watches it fan out.
 *
 * This talks to the running app over HTTP rather than importing
 * `@/lib/pipeline/runs` directly, and that is the whole point. Runs live in a
 * `globalThis` Map flushed to `data/pipeline/runs.json` — one owner per
 * process. A scheduled CLI that imported the store would load its own copy of
 * that Map, advance runs the server knows nothing about, and the two would
 * overwrite each other's `runs.json` on every write. Going through the API
 * keeps the server the single owner of run state.
 *
 * It also gets the work done in the right place: `GET /api/pipeline` advances
 * every run as a side effect of reporting on it, so polling from here is what
 * drives the fan-out — the same mechanism the pipeline page uses.
 */

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export class AppUnreachableError extends Error {
  constructor(base: string, cause: string) {
    super(
      `Could not reach Capital Command at ${base} (${cause}). The pipeline runs inside the app, so it has to be ` +
        `running for the scan to hand anything to it. Start it with \`npm run dev\` (or \`npm run start\`), or set ` +
        `APP_BASE_URL if it listens somewhere else.`
    );
    this.name = "AppUnreachableError";
  }
}

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const base = appBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) }
    });
  } catch (error) {
    throw new AppUnreachableError(base, error instanceof Error ? error.message : String(error));
  }
  const text = await response.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    // Non-JSON body — surfaced through the status check below.
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return body;
}

/** True when the app is up and serving the pipeline API. */
export async function appReachable(): Promise<boolean> {
  try {
    await call("/api/pipeline");
    return true;
  } catch (error) {
    if (error instanceof AppUnreachableError) return false;
    // Reachable but unhappy (e.g. ffmpeg missing) — that is a different
    // problem, and the caller should see it rather than be told nothing is
    // listening.
    return true;
  }
}

/** Starts a run from a VOD link. Returns the new run's id. */
export async function startPipelineRun(url: string, name: string): Promise<string> {
  const body = await call("/api/pipeline", { method: "POST", body: JSON.stringify({ url, name }) });
  const id = (body as { run?: { id?: unknown } } | undefined)?.run?.id;
  if (typeof id !== "string" || !id) {
    throw new Error("The pipeline accepted the stream but returned no run id.");
  }
  return id;
}

/** Every run, joined with live stage state. Fetching this ADVANCES the runs. */
export async function fetchOverviews(): Promise<PipelineRunOverview[]> {
  const body = await call("/api/pipeline");
  const runs = (body as { runs?: unknown } | undefined)?.runs;
  return Array.isArray(runs) ? (runs as PipelineRunOverview[]) : [];
}

export type PipelineWaitResult = {
  outcome: "ready" | "error" | "timeout";
  error?: string;
  overview?: PipelineRunOverview;
};

/**
 * Polls until the run settles — every stage past `waiting`/`running` — or the
 * deadline passes.
 *
 * A timeout is not a cancellation: the app keeps working on the run, and the
 * ledger records the video as unsettled so tomorrow's scan re-checks it instead
 * of starting the download over.
 */
export async function waitForPipelineRun(
  runId: string,
  timeoutMs: number,
  pollMs: number,
  onProgress?: (line: string) => void
): Promise<PipelineWaitResult> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  let missing = 0;

  while (Date.now() < deadline) {
    let overviews: PipelineRunOverview[];
    try {
      overviews = await fetchOverviews();
    } catch (error) {
      if (error instanceof AppUnreachableError) {
        // The app went down mid-run (restart, machine sleep). Nothing here can
        // advance the run, so stop waiting and let the next scan re-check.
        return { outcome: "timeout", error: error.message };
      }
      throw error;
    }

    const overview = overviews.find((item) => item.run.id === runId);
    if (!overview) {
      // Runs are capped at MAX_RUNS; a very busy day could evict this one.
      missing += 1;
      if (missing >= 3) {
        return { outcome: "error", error: "The run disappeared from the pipeline before it settled." };
      }
      await sleep(pollMs);
      continue;
    }
    missing = 0;

    const line = describe(overview);
    if (line !== last) {
      last = line;
      onProgress?.(line);
    }

    if (overview.run.status === "error") {
      return { outcome: "error", error: overview.run.error ?? "The pipeline run failed.", overview };
    }
    if (overview.settled) return { outcome: "ready", overview };

    await sleep(pollMs);
  }

  return { outcome: "timeout" };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One line describing where every stage stands, for the scan log. */
export function describe(overview: PipelineRunOverview): string {
  if (overview.run.status === "ingesting") {
    return `downloading ${overview.run.progress ?? 0}%`;
  }
  return (Object.keys(overview.stages) as (keyof typeof overview.stages)[])
    .filter((key) => overview.stages[key].status !== "waiting")
    .map((key) => `${key}:${overview.stages[key].status}`)
    .join(" ");
}
