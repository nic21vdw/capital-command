import type { PlatformRunway } from "@/lib/publisher/runway";

// What the Weekly Shorts Review page says. Pure, so the browser bundle can
// import it and every sentence is tested.

/** How many clips would fill the emptiest platform's next week, never more than are waiting. */
export function fillTheWeek(runway: PlatformRunway[], waiting: number): number {
  const gap = runway.reduce((most, entry) => Math.max(most, entry.expected - entry.booked - entry.held), 0);
  return Math.max(0, Math.min(gap, waiting));
}

const LABEL: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn" };

export function platformLabel(platform: string): string {
  return LABEL[platform] ?? platform;
}

export function runwayLine(entry: PlatformRunway): string {
  return `${platformLabel(entry.platform)} ${entry.booked} of ${entry.expected}${entry.held ? ` (+${entry.held} waiting for your approval)` : ""}`;
}

export function durationLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function slotLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export type BookReply = {
  booked: { title: string; publishAt: string }[];
  failed: { title: string; error: string }[];
  stale: string[];
};

/** One sentence for the toast; the page lists the detail under it. */
export function bookingSummary(reply: BookReply): { tone: "success" | "warning" | "error"; text: string } {
  const parts: string[] = [];
  if (reply.booked.length) parts.push(`${reply.booked.length} Short${reply.booked.length === 1 ? "" : "s"} booked`);
  if (reply.failed.length) parts.push(`${reply.failed.length} could not be booked`);
  if (reply.stale.length) parts.push(`${reply.stale.length} ${reply.stale.length === 1 ? "was" : "were"} already booked or no longer waiting`);
  if (!parts.length) return { tone: "warning", text: "Nothing was booked." };
  const text = `${parts.join(", ")}.`;
  return { tone: reply.failed.length ? (reply.booked.length ? "warning" : "error") : reply.booked.length ? "success" : "warning", text: text.charAt(0).toUpperCase() + text.slice(1) };
}
