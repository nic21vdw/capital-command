import type { YoutubeLedger } from "@/lib/listening/scan";
import { readListeningStore, updateListeningStore } from "@/lib/listening/store";
import { youtubeQuotaLedger, type QuotaLedger } from "@/lib/youtube/quotaLedger";

export function storeLedger(quota: Pick<QuotaLedger, "debit" | "remaining" | "snapshot"> = youtubeQuotaLedger): YoutubeLedger {
  return {
    position: async (day) => {
      const [{ youtube }, today] = await Promise.all([readListeningStore(), quota.snapshot()]);
      return { units: today.day === day ? (today.byPurpose.listening ?? 0) : 0, cursor: youtube.cursor };
    },
    reserve: async (units) => (await quota.debit(units, "listening")).ok,
    exhaust: async () => {
      const left = await quota.remaining("listening");
      if (left > 0) await quota.debit(left, "listening");
    },
    advance: async (by) => {
      await updateListeningStore((store) => ({ ...store, youtube: { ...store.youtube, cursor: store.youtube.cursor + by } }));
    }
  };
}
