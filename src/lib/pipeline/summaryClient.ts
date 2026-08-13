/**
 * `GET /api/pipeline?summary=1` answers the shell's two pollers at once — the
 * stream list in the sidebar and the needs-attention count — and both mount on
 * every page. Firing it twice in the same tick cost two of the browser's six
 * sockets per origin before the page's own data could ask for one, so callers
 * in flight together share the single request.
 */
export type PipelineSummary = {
  streams?: unknown[];
  needsAttention?: number;
  working?: number;
  scan?: unknown;
};

let inFlight: Promise<PipelineSummary | null> | null = null;

export function readPipelineSummary(): Promise<PipelineSummary | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const response = await fetch("/api/pipeline?summary=1", { cache: "no-store" });
      return response.ok ? ((await response.json()) as PipelineSummary) : null;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
