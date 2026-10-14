import { syncInbox } from "@/lib/inbox/sync";

export const INBOX_SYNC_INTERVAL_MS = 30 * 60_000;
export const INBOX_FIRST_SYNC_MS = 2 * 60_000;

type SchedulerSlot = typeof globalThis & { __inboxScheduler?: NodeJS.Timeout };

function disabled(): boolean {
  const raw = process.env.INBOX_SYNC_ENABLED?.trim().toLowerCase();
  return raw === "false" || raw === "0" || raw === "off" || raw === "no";
}

async function tick(): Promise<void> {
  try {
    const report = await syncInbox();
    const touched = Object.values(report.platforms).filter((entry) => entry && entry.fetchedPosts > 0).length;
    if (report.added > 0 || touched > 0) console.log(`[inbox] sync: ${report.added} new item(s) across ${touched} platform(s).`);
  } catch (error) {
    console.warn(`[inbox] sync failed (${error instanceof Error ? error.name : "error"}); it will try again.`);
  }
}

export function startInboxScheduler(): void {
  if (disabled()) return;
  const slot = globalThis as SchedulerSlot;
  if (slot.__inboxScheduler) return;
  slot.__inboxScheduler = setInterval(() => void tick(), INBOX_SYNC_INTERVAL_MS);
  slot.__inboxScheduler.unref?.();
  setTimeout(() => void tick(), INBOX_FIRST_SYNC_MS).unref?.();
}
