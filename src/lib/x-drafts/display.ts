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
