import { youtubeQuotaLedger, type QuotaLedger, type QuotaPurpose } from "@/lib/youtube/quotaLedger";

export const QUOTA_SAVED_MESSAGE = "YouTube quota saved for uploads";

type Debiter = Pick<QuotaLedger, "debit">;

export class QuotaSavedError extends Error {
  constructor(
    readonly purpose: QuotaPurpose,
    readonly reason: "budget" | "unavailable" | "invalid-units"
  ) {
    super(
      reason === "unavailable"
        ? `${QUOTA_SAVED_MESSAGE}: the quota ledger could not be read, so this ${purpose} call was skipped.`
        : `${QUOTA_SAVED_MESSAGE}: today's share for ${purpose} is used, so this call was skipped until the quota resets after midnight Pacific.`
    );
    this.name = "QuotaSavedError";
  }
}

export async function debitUpload(units: number, ledger: Debiter = youtubeQuotaLedger): Promise<void> {
  await ledger.debit(units, "upload").catch(() => undefined);
}

export async function debitOrSkip(units: number, purpose: QuotaPurpose, ledger: Debiter = youtubeQuotaLedger): Promise<void> {
  const result = await ledger.debit(units, purpose);
  if (!result.ok) throw new QuotaSavedError(purpose, result.reason);
}
