import { youtubeQuotaLedger, type QuotaLedger } from "@/lib/youtube/quotaLedger";

export const YOUTUBE_READ_UNITS = 1;
export const YOUTUBE_REPLY_UNITS = 50;

type Debiter = Pick<QuotaLedger, "debit">;

export async function reserveInboxRead(quota: Debiter = youtubeQuotaLedger): Promise<boolean> {
  return (await quota.debit(YOUTUBE_READ_UNITS, "inbox")).ok;
}

export async function chargeInboxReply(quota: Debiter = youtubeQuotaLedger): Promise<void> {
  await quota.debit(YOUTUBE_REPLY_UNITS, "inbox-reply");
}
