import type { YoutubeLedger } from "@/lib/listening/scan";
import { readListeningStore, updateListeningStore } from "@/lib/listening/store";
import { quotaDate } from "@/lib/publisher/quota";

export function storeLedger(): YoutubeLedger {
  return {
    position: async (day) => {
      const { youtube } = await readListeningStore();
      return { units: youtube.day === day ? youtube.units : 0, cursor: youtube.cursor };
    },
    reserve: async (units, budget, day) => {
      let granted = false;
      await updateListeningStore((store) => {
        const spent = store.youtube.day === day ? store.youtube.units : 0;
        granted = spent + units <= budget;
        return { ...store, youtube: { ...store.youtube, day, units: granted ? spent + units : spent } };
      });
      return granted;
    },
    exhaust: async (budget, day) => {
      await updateListeningStore((store) => {
        const spent = store.youtube.day === day ? store.youtube.units : 0;
        return { ...store, youtube: { ...store.youtube, day, units: Math.max(spent, budget) } };
      });
    },
    advance: async (by) => {
      await updateListeningStore((store) => ({ ...store, youtube: { ...store.youtube, cursor: store.youtube.cursor + by } }));
    }
  };
}

export async function listeningUnitsToday(now: Date): Promise<number> {
  try {
    const { youtube } = await readListeningStore();
    return youtube.day === quotaDate(now) ? youtube.units : 0;
  } catch {
    return 0;
  }
}
