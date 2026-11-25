import type { LiveFactsSnapshot, LiveSource } from "@/lib/x-drafts/liveFacts";
import type { XDraft } from "@/lib/x-drafts/types";

export function slotLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

export function dayHeading(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));
}

export function draftThreadsLabel(draft: XDraft, timeZone: string): string {
  if (draft.status === "dismissed") return "Not posting anywhere";
  if (draft.threadsAt) {
    const clock = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(draft.threadsAt));
    return `Threads at ${clock}`;
  }
  return draft.threadsNote ?? "X only";
}

export function summarizeDrafts(drafts: XDraft[]): { waiting: number; postedOnX: number; onThreads: number } {
  return {
    waiting: drafts.filter((draft) => draft.status === "new").length,
    postedOnX: drafts.filter((draft) => draft.status === "posted-x").length,
    onThreads: drafts.filter((draft) => draft.status !== "dismissed" && draft.threadsAt).length
  };
}

const SOURCE_LABELS: Record<LiveSource, string> = {
  stream: "Stream day",
  streamNotes: "What you said on stream",
  channel: "Subscribers",
  videos: "New videos",
  releases: "Desktop releases",
  colateral: "CoLateral changes",
  arcade: "Arcade changes"
};

export type LiveSourceRow = { source: LiveSource; label: string; count: number; sample: string | null; problem: string | null };

export function liveSourceRows(snapshot: LiveFactsSnapshot): LiveSourceRow[] {
  return (Object.keys(SOURCE_LABELS) as LiveSource[]).map((source) => {
    const entry = snapshot.sources[source];
    const facts = entry?.facts ?? [];
    return {
      source,
      label: SOURCE_LABELS[source],
      count: facts.length,
      sample: facts[0]?.text ?? null,
      problem: !entry ? "Not read yet" : entry.ok ? null : facts.length ? "Using the last good read" : "Could not read"
    };
  });
}
