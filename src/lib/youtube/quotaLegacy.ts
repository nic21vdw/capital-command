import type { PurposeUnits } from "@/lib/youtube/quotaLedger";

export async function legacyUnitsFor(day: string): Promise<PurposeUnits> {
  const carried: PurposeUnits = {};

  const inbox = await import("@/lib/inbox/store").then((store) => store.readInbox()).catch(() => null);
  if (inbox?.youtubeUnits?.date === day && inbox.youtubeUnits.used > 0) carried.inbox = inbox.youtubeUnits.used;

  const listening = await import("@/lib/listening/store").then((store) => store.readListeningStore()).catch(() => null);
  if (listening?.youtube.day === day && listening.youtube.units > 0) carried.listening = listening.youtube.units;

  return carried;
}
