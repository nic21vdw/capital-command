import { readFile } from "node:fs/promises";
import { dataPath } from "@/lib/paths";
import { YOUTUBE_DAILY_UNITS, YOUTUBE_UNITS_PER_UPLOAD, quotaDate } from "@/lib/publisher/quota";
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
  | { ok: true; remaining: number; unmetered?: true }
  | { ok: false; reason: "budget" | "unavailable" | "invalid-units"; remaining: number };

export type LedgerSnapshot = {
  day: string;
  dailyUnits: number;
  spent: number;
  byPurpose: Partial<Record<QuotaPurpose, number>>;
  uploadReserve: number;
  nonUploadCapConfigured: number;
  nonUploadAllowance: number;
  nonUploadClamped: boolean;
  nonUploadSpent: number;
  nonUploadRemaining: number;
};

export const DEFAULT_UPLOADS_PER_DAY = 6;
export const DEFAULT_NON_UPLOAD_UNITS = 300;
export const LEDGER_LOCK_TIMEOUT_MS = 5000;

function wholeNumber(raw: string | undefined, fallback: number, minimum: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= minimum ? value : fallback;
}

export function ledgerConfig(env: Record<string, string | undefined> = process.env): LedgerConfig {
  return {
    dailyUnits: YOUTUBE_DAILY_UNITS,
    uploadsPerDay: wholeNumber(env.YOUTUBE_DAILY_UPLOAD_BUDGET, DEFAULT_UPLOADS_PER_DAY, 0),
    unitsPerUpload: YOUTUBE_UNITS_PER_UPLOAD,
    nonUploadUnits: wholeNumber(env.YOUTUBE_NON_UPLOAD_DAILY_UNITS, DEFAULT_NON_UPLOAD_UNITS, 0)
  };
}

export function quotaLedgerFile(): string {
  return dataPath("youtube-quota.json");
}

type Stored = { day: string; units: Partial<Record<QuotaPurpose, number>> };

function limits(config: LedgerConfig) {
  const uploadReserve = config.uploadsPerDay * config.unitsPerUpload;
  const room = Math.max(0, config.dailyUnits - uploadReserve);
  const nonUploadAllowance = Math.min(config.nonUploadUnits, room);
  return { uploadReserve, nonUploadAllowance, nonUploadClamped: nonUploadAllowance < config.nonUploadUnits };
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
  const { uploadReserve, nonUploadAllowance, nonUploadClamped } = limits(config);
  return {
    day,
    dailyUnits: config.dailyUnits,
    spent,
    byPurpose: { ...units },
    uploadReserve,
    nonUploadCapConfigured: config.nonUploadUnits,
    nonUploadAllowance,
    nonUploadClamped,
    nonUploadSpent,
    nonUploadRemaining: Math.max(0, Math.min(nonUploadAllowance - nonUploadSpent, config.dailyUnits - spent))
  };
}

export function createQuotaLedger(
  deps: { now?: () => Date; file?: () => string; config?: () => LedgerConfig; lockTimeoutMs?: number } = {}
) {
  const now = deps.now ?? (() => new Date());
  const file = deps.file ?? quotaLedgerFile;
  const config = deps.config ?? (() => ledgerConfig());
  let warned = false;

  function warnIfClamped(settings: LedgerConfig): void {
    const { nonUploadAllowance, nonUploadClamped, uploadReserve } = limits(settings);
    if (!nonUploadClamped || warned) return;
    warned = true;
    console.warn(
      `[youtube-quota] YOUTUBE_NON_UPLOAD_DAILY_UNITS=${settings.nonUploadUnits} would eat into the ${uploadReserve} units reserved for ` +
        `${settings.uploadsPerDay} uploads of ${settings.unitsPerUpload}; capped at ${nonUploadAllowance}.`
    );
  }

  async function snapshot(): Promise<LedgerSnapshot> {
    const settings = config();
    warnIfClamped(settings);
    return snapshotOf(await readStored(file()), quotaDate(now()), settings);
  }

  async function remaining(purpose: QuotaPurpose): Promise<number> {
    try {
      const state = await snapshot();
      return purpose === "upload" ? Math.max(0, state.dailyUnits - state.spent) : state.nonUploadRemaining;
    } catch {
      return purpose === "upload" ? config().dailyUnits : 0;
    }
  }

  async function debit(units: number, purpose: QuotaPurpose): Promise<DebitResult> {
    const upload = purpose === "upload";
    if (!Number.isInteger(units) || units <= 0) {
      return upload ? { ok: true, remaining: 0, unmetered: true } : { ok: false, reason: "invalid-units", remaining: await remaining(purpose) };
    }
    try {
      return await withFileLock(
        file(),
        async (): Promise<DebitResult> => {
          const settings = config();
          warnIfClamped(settings);
          const day = quotaDate(now());
          const state = snapshotOf(await readStored(file()), day, settings);
          const room = upload ? Math.max(0, state.dailyUnits - state.spent) : state.nonUploadRemaining;
          if (!upload && units > room) return { ok: false, reason: "budget", remaining: room };
          const next: Stored = { day, units: { ...state.byPurpose, [purpose]: (state.byPurpose[purpose] ?? 0) + units } };
          await atomicWriteJson(file(), next);
          return { ok: true, remaining: Math.max(0, room - units) };
        },
        { timeoutMs: deps.lockTimeoutMs ?? LEDGER_LOCK_TIMEOUT_MS }
      );
    } catch {
      return upload ? { ok: true, remaining: 0, unmetered: true } : { ok: false, reason: "unavailable", remaining: 0 };
    }
  }

  function nextResetAt(from: Date): Date {
    const today = quotaDate(from);
    let low = Math.floor(from.getTime() / 1000);
    let high = low + 15 * 60;
    for (let step = 0; step < 120 && quotaDate(new Date(high * 1000)) === today; step += 1) {
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
