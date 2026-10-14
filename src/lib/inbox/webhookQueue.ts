import { ingestInstagramEvents } from "@/lib/inbox/webhook";

const MAX_PENDING = 1000;

type QueueState = { pending: unknown[]; worker: Promise<void> | null };
type QueueSlot = typeof globalThis & { __inboxWebhookQueue?: QueueState };

function state(): QueueState {
  const slot = globalThis as QueueSlot;
  slot.__inboxWebhookQueue ??= { pending: [], worker: null };
  return slot.__inboxWebhookQueue;
}

async function drain(queue: QueueState): Promise<void> {
  while (queue.pending.length > 0) {
    const batch = queue.pending.splice(0, queue.pending.length);
    try {
      const stored = await ingestInstagramEvents(batch);
      if (stored > 0) console.log(`[inbox] Instagram webhook stored ${stored} new item(s).`);
    } catch (error) {
      console.warn(
        `[inbox] ${batch.length} Instagram webhook event(s) were not stored (${error instanceof Error ? error.name : "error"}); the next sync will find them.`
      );
    }
  }
}

export function queueInstagramEvent(payload: unknown): void {
  const queue = state();
  queue.pending.push(payload);
  if (queue.pending.length > MAX_PENDING) queue.pending.splice(0, queue.pending.length - MAX_PENDING);
  if (queue.worker) return;
  queue.worker = new Promise<void>((resolve) => {
    setTimeout(() => {
      void drain(queue).finally(() => {
        queue.worker = null;
        resolve();
      });
    }, 0);
  });
}

export async function webhookQueueIdle(): Promise<void> {
  const queue = state();
  while (queue.worker) await queue.worker;
}
