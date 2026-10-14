import { readFile } from "node:fs/promises";
import { dataPath } from "@/lib/paths";
import { YOUTUBE_DAILY_UNITS, quotaDate } from "@/lib/publisher/quota";
import { atomicWriteJson } from "@/lib/storage/atomic-json";
import { withFileLock } from "@/lib/storage/file-lock";

export type QuotaPurpose = "upload" | "analytics" | "inbox" | "listening" | "outliers";

export type LedgerConfig = {
  dailyUnits: number;
  uploadsPerDay: number;
  unitsPerUpload: number;
  nonUploadUnits: number;
};

export type DebitResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: "non-upload-allowance" | "daily-quota" | "invalid-units" | "ledger-unreadable"; remaining: number };

export type LedgerSnapshot = {
  day: string;
  dailyUnits: number;
  spent: number;
  byPurpose: Partial<Record<QuotaPurpose, number>>;
  uploadReserveConfigured: number;
  uploadReserve: number;
  nonUploadAllowance: number;
  nonUploadSpent: number;
  nonUploadRemaining: number;
};

export const DEFAULT_UPLOADS_PER_DAY = 6;
export const DEFAULT_UNITS_PER_UPLOAD = 1700;
export const DEFAULT_NON_UPLOAD_UNITS = 300;

function wholeNumber(raw: string | undefined, fallback: number, minimum: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= minimum ? value : fallback;
}

export function ledgerConfig(env: Record<string, string | undefined> = process.env): LedgerConfig {
  return {
    dailyUnits: YOUTUBE_DAILY_UNITS,
    uploadsPerDay: wholeNumber(env.YOUTUBE_DAILY_UPLOAD_BUDGET, DEFAULT_UPLOADS_PER_DAY, 0),
    unitsPerUpload: DEFAULT_UNITS_PER_UPLOAD,
    nonUploadUnits: wholeNumber(env.YOUTUBE_NON_UPLOAD_DAILY_UNITS, DEFAULT_NON_UPLOAD_UNITS, 0)
  };
}

export function quotaLedgerFile(): string {
  return dataPath("youtube-quota.json");
}

type Stored = { day: string; units: Partial<Record<QuotaPurpose, number>> };

function limits(config: LedgerConfig) {
  const uploadReserveConfigured = config.uploadsPerDay * config.unitsPerUpload;
  const cap = Math.min(config.nonUploadUnits, config.dailyUnits);
  const uploadReserve = Math.min(uploadReserveConfigured, config.dailyUnits - cap);
  const nonUploadAllowance = Math.min(cap, config.dailyUnits - uploadReserve);
  return { uploadReserveConfigured, uploadReserve, nonUploadAllowance };
}

function totals(units: Stored["units"]) {
  let spent = 0;
  let nonUploadSpent = 0;
  for (const [purpose, value] of Object.entries(units)) {
    spent += value ?? 0;
    if (purpose !== "upload") nonUploadSpent += value ?? 0;
  }
  return { spent, nonUploadSpent };
}

function parseStored(text: string): Stored {
  const parsed = JSON.parse(text) as { day?: unknown; units?: unknown };
  if (typeof parsed.day !== "string" || typeof parsed.units !== "object" || parsed.units === null) {
    throw new Error("not a quota ledger");
  }
  const units: Stored["units"] = {};
  for (const [purpose, value] of Object.entries(parsed.units as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) units[purpose as QuotaPurpose] = value;
  }
  return { day: parsed.day, units };
}

async function readStored(file: string): Promise<Stored | null> {
  try {
    return parseStored(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function snapshotOf(stored: Stored | null, day: string, config: LedgerConfig): LedgerSnapshot {
  const units = stored && stored.day === day ? stored.units : {};
  const { spent, nonUploadSpent } = totals(units);
  const { uploadReserveConfigured, uploadReserve, nonUploadAllowance } = limits(config);
  return {
    day,
    dailyUnits: config.dailyUnits,
    spent,
    byPurpose: { ...units },
    uploadReserveConfigured,
    uploadReserve,
    nonUploadAllowance,
    nonUploadSpent,
    nonUploadRemaining: Math.max(0, Math.min(nonUploadAllowance - nonUploadSpent, config.dailyUnits - spent))
  };
}

export function createQuotaLedger(
  deps: { now?: () => Date; file?: () => string; config?: () => LedgerConfig } = {}
) {
  const now = deps.now ?? (() => new Date());
  const file = deps.file ?? quotaLedgerFile;
  const config = deps.config ?? (() => ledgerConfig());

  async function snapshot(): Promise<LedgerSnapshot> {
    return snapshotOf(await readStored(file()), quotaDate(now()), config());
  }

  async function remaining(purpose: QuotaPurpose): Promise<number> {
    try {
      const state = await snapshot();
      return purpose === "upload" ? Math.max(0, state.dailyUnits - state.spent) : state.nonUploadRemaining;
    } catch {
      return 0;
    }
  }

  async function debit(units: number, purpose: QuotaPurpose): Promise<DebitResult> {
    if (!Number.isInteger(units) || units <= 0) return { ok: false, reason: "invalid-units", remaining: await remaining(purpose) };
    try {
      return await withFileLock(file(), async () => {
        const day = quotaDate(now());
        const settings = config();
        const stored = await readStored(file());
        const state = snapshotOf(stored, day, settings);
        const room = purpose === "upload" ? state.dailyUnits - state.spent : state.nonUploadRemaining;
        if (units > room) {
          const reason =
            purpose !== "upload" && units > state.nonUploadAllowance - state.nonUploadSpent ? "non-upload-allowance" : "daily-quota";
          return { ok: false, reason, remaining: Math.max(0, room) } as const;
        }
        const next: Stored = { day, units: { ...state.byPurpose, [purpose]: (state.byPurpose[purpose] ?? 0) + units } };
        await atomicWriteJson(file(), next);
        return { ok: true, remaining: room - units } as const;
      });
    } catch {
      return { ok: false, reason: "ledger-unreadable", remaining: 0 };
    }
  }

  function nextResetAt(from: Date): Date {
    const today = quotaDate(from);
    let low = Math.floor(from.getTime() / 1000);
    let high = low + 15 * 60;
    while (quotaDate(new Date(high * 1000)) === today && high - low < 26 * 3600) {
      low = high;
      high += 15 * 60;
    }
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (quotaDate(new Date(middle * 1000)) === today) low = middle;
      else high = middle;
    }
    return new Date(high * 1000);
  }

  return { debit, remaining, snapshot, nextResetAt };
}

export type QuotaLedger = ReturnType<typeof createQuotaLedger>;

export const youtubeQuotaLedger: QuotaLedger = createQuotaLedger();
