import type { XDailyPack } from "@/types/domain";

/**
 * Pure, isomorphic helpers that turn a generated pack into a Threads-ready
 * schedule export. "Ready to send into Threads" means: the reworded Threads
 * variant of every post (never the X text — the two feeds must stay distinct),
 * each paired with the suggested posting time as an absolute datetime an
 * automation can schedule against. Two shapes are produced — CSV for
 * spreadsheets / most schedulers, JSON for API/script pipelines.
 */

export interface ScheduledThreadsPost {
  slot: number;
  /** ISO 8601 with the exporting machine's local offset, e.g. 2026-07-22T07:15:00-06:00. */
  scheduledAt: string;
  date: string; // YYYY-MM-DD (local)
  time: string; // HH:MM (local)
  format: string;
  topic: string;
  text: string; // Threads variant — the copy that actually gets posted
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Combine a pack's local date key and a post's HH:MM into a full ISO 8601
 * timestamp carrying the local UTC offset, so a scheduler places the post at
 * the intended wall-clock time regardless of where the automation runs.
 */
export function scheduledIso(dateKey: string, time: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const local = new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);
  const offsetMin = -local.getTimezoneOffset(); // minutes east of UTC
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${dateKey}T${pad(hh ?? 0)}:${pad(mm ?? 0)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function toScheduledPosts(pack: XDailyPack): ScheduledThreadsPost[] {
  return pack.posts.map((post) => ({
    slot: post.slot,
    scheduledAt: scheduledIso(pack.date, post.time),
    date: pack.date,
    time: post.time,
    format: post.format,
    topic: post.topic,
    text: post.threadsVariant
  }));
}

/** RFC 4180 field escaping: quote when the value carries a comma, quote or newline. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const CSV_HEADER = ["slot", "scheduled_at", "date", "time", "format", "topic", "text"] as const;

export function toThreadsCsv(pack: XDailyPack): string {
  const rows = toScheduledPosts(pack).map((post) =>
    [String(post.slot), post.scheduledAt, post.date, post.time, post.format, post.topic, post.text]
      .map(csvField)
      .join(",")
  );
  return [CSV_HEADER.join(","), ...rows].join("\r\n");
}

export function toThreadsJson(pack: XDailyPack): string {
  return JSON.stringify(toScheduledPosts(pack), null, 2);
}

export function exportBaseName(pack: XDailyPack): string {
  return `threads-schedule-${pack.date}`;
}
