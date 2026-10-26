import type { BackupView } from "@/lib/backup/status";
import type { SurfaceReading } from "@/lib/colateral/protocol";
import { RECONNECT_URL, type PlatformHealthResponse } from "@/lib/platform-health/types";
import { ALL_PLATFORMS, type PlatformId, type QueueItem } from "@/lib/publisher/types";
import { instantLabel } from "@/components/uploading-center/schedule-summary";

const PLATFORM_NAMES: Record<PlatformId, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  linkedin: "LinkedIn"
};

const MAX_REASON = 160;

export function queueStatusReadings(items: QueueItem[], now: Date, timeZone: string): SurfaceReading[] {
  return ALL_PLATFORMS.map((platform) => {
    let pending = 0;
    let overdue = 0;
    let scheduled = 0;
    let failed = 0;
    let manual = 0;
    let next: number | null = null;
    for (const item of items) {
      const state = item.platforms[platform];
      if (!state) continue;
      const at = Date.parse(item.publishAt);
      if (state.status === "pending" || state.status === "uploaded") {
        pending += 1;
        if (at < now.getTime()) overdue += 1;
      } else if (state.status === "scheduled") {
        scheduled += 1;
      } else if (state.status === "failed") {
        failed += 1;
      } else if (state.status === "manual") {
        manual += 1;
      } else {
        continue;
      }
      const live = state.status === "pending" || state.status === "uploaded" || state.status === "scheduled";
      if (live && Number.isFinite(at) && at >= now.getTime() && (next === null || at < next)) next = at;
    }
    const label = `Queue: ${PLATFORM_NAMES[platform]}`;
    if (pending + scheduled + failed + manual === 0) return { label, value: "Nothing queued." };
    const counts = [
      `${pending} pending${overdue ? ` (${overdue} overdue)` : ""}`,
      `${scheduled} scheduled`,
      `${failed} failed`,
      ...(manual ? [`${manual} manual`] : [])
    ].join(", ");
    const slot = next === null ? "no upcoming slot" : `next slot ${instantLabel(new Date(next), timeZone)}`;
    return { label, value: `${counts}; ${slot}.` };
  });
}

function shortReason(reason: string): string {
  return reason.length > MAX_REASON ? `${reason.slice(0, MAX_REASON - 1)}…` : reason;
}

export function brokenAccountsReading(health: PlatformHealthResponse | null): SurfaceReading {
  const label = "Broken accounts";
  if (!health) return { label, value: "Not checked yet." };
  if (!health.broken.length) return { label, value: "None." };
  return {
    label,
    value: health.broken
      .map((account) => {
        const fix = account.fixUrl.startsWith("/") && !account.fixUrl.startsWith("//") ? account.fixUrl : RECONNECT_URL;
        const failures = `${account.failures} ${account.failures === 1 ? "failure" : "failures"}`;
        return `${account.displayName || account.label}: ${shortReason(account.reason)} (since ${account.since.slice(0, 10)}, ${failures}). Reconnect at ${fix}.`;
      })
      .join(" | ")
  };
}

export function quotaReadings(input: {
  youtube?: { used: number; budget: number };
  shortsPerDay?: number;
  shortsByDay: Map<string, number>;
  todayKey?: string;
}): SurfaceReading[] {
  const { youtube, shortsPerDay, shortsByDay, todayKey } = input;
  const parts: string[] = [];
  if (youtube) parts.push(`YouTube uploads ${youtube.used}/${youtube.budget}`);
  if (shortsPerDay && todayKey) parts.push(`shorts booked for today ${shortsByDay.get(todayKey) ?? 0}/${shortsPerDay}`);
  const full = shortsPerDay
    ? [...shortsByDay]
        .filter(([day, count]) => count >= shortsPerDay && (!todayKey || day >= todayKey))
        .map(([day]) => day)
        .sort()
    : [];
  return [
    { label: "Today's quota", value: parts.length ? `${parts.join("; ")}.` : "Not loaded yet." },
    { label: "Days at the shorts cap", value: full.length ? full.join(", ") : "None." }
  ];
}

export function backupReading(view: BackupView | null): SurfaceReading {
  const label = "Last backup";
  if (!view) return { label, value: "Checking." };
  const text = view.text.replace(/^Last backup: /, "");
  return { label, value: view.warning ? `${text} - needs attention` : text };
}
