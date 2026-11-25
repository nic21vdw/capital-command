import { publishQueue } from "@/lib/publisher/queue";
import type { ThreadsConfig } from "@/lib/threads/config";
import { mirrorConfig, planInstagramMirrors, type MirrorConfig } from "@/lib/threads/mirror";
import { mutateQueue } from "@/lib/threads/queue";

export type MirrorOutcome = { booked: number; notes: Array<{ itemId: string; note: string }> };

export async function mirrorInstagramToThreads(options: { threads: ThreadsConfig; now: Date; mirror?: MirrorConfig }): Promise<MirrorOutcome> {
  const mirror = options.mirror ?? mirrorConfig();
  if (!mirror.enabled || options.threads.accounts.length === 0) return { booked: 0, notes: [] };
  const publishItems = await publishQueue().list();
  return mutateQueue((items) => {
    const plan = planInstagramMirrors({ publishItems, queue: items, threads: options.threads, mirror, now: options.now });
    return { items: plan.items.length ? [...items, ...plan.items] : items, result: { booked: plan.items.length, notes: plan.notes } };
  });
}
