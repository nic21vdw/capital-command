import type { PipelineRunOverview } from "@/lib/pipeline/types";

// What a run looks like in a list. A run whose stages broke used to read as a
// green "Finished" — an errored stage settles the run, so the only thing that
// said otherwise was the flow he had to open. Every surface that lists runs
// reads this, so none of them can go back to claiming a broken run is done.

export type RunTone = "attention" | "working" | "done";

export type RunListStatus = { tone: RunTone; label: string };

export function runListStatus(entry: Pick<PipelineRunOverview, "run" | "retryable" | "settled">): RunListStatus {
  if (entry.run.status === "error") return { tone: "attention", label: "Needs attention" };
  // An output the app promised to book and could not is a real, unfixed
  // problem — it must never read as green "Finished", which is the whole point
  // of this function.
  const unbooked = entry.run.queueFailures?.length ?? 0;
  if (unbooked > 0) {
    return { tone: "attention", label: `${unbooked} not scheduled` };
  }
  const stuck = entry.retryable?.length ?? 0;
  if (stuck > 0) {
    return { tone: "attention", label: `${stuck} stage${stuck === 1 ? " needs" : "s need"} attention` };
  }
  if (entry.settled) return { tone: "done", label: "Finished" };
  return { tone: "working", label: "Running" };
}
