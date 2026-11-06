import { readFile } from "node:fs/promises";
import { dataPath } from "@/lib/paths";
import { YOUTUBE_DAILY_UNITS, YOUTUBE_UNITS_PER_UPLOAD, quotaDate } from "@/lib/publisher/quota";
import { atomicWriteJson } from "@/lib/storage/atomic-json";
import { withFileLock } from "@/lib/storage/file-lock";
import { legacyUnitsFor } from "@/lib/youtube/quotaLegacy";

export const QUOTA_PURPOSES = [
  "upload",
  "analytics",
  "inbox",
  "inbox-reply",
  "listening",
  "outliers",
  "stats",
  "schedule",
  "ingest",
  "channel"
] as const;

export type QuotaPurpose = (typeof QUOTA_PURPOSES)[number];

export type PurposeUnits = Partial<Record<QuotaPurpose, number>>;

export const NEVER_REFUSED: readonly QuotaPurpose[] = ["upload", "inbox-reply"];

export type LedgerConfig = {
  dailyUnits: number;
  uploadsPerDay: number;
  unitsPerUpload: number;
  nonUploadUnits: number;
  purposeCaps?: PurposeUnits;
};

export type DebitResult =
  | { ok: true; remaining: number; unmetered?: true }
  | { ok: false; reason: "budget" | "unavailable" | "invalid-units"; remaining: number };

export type LedgerSnapshot = {
  day: string;
  dailyUnits: number;
  spent: number;
  byPurpose: PurposeUnits;
  purposeCaps: PurposeUnits;
  uploadReserve: number;
  nonUploadCapConfigured: number;
  nonUploadAllowance: number;
  nonUploadClamped: boolean;
  nonUploadSpent: number;
  nonUploadRemaining: number;
};

export const DEFAULT_UPLOADS_PER_DAY = 6;
export const DEFAULT_NON_UPLOAD_UNITS = 300;
export const DEFAULT_INBOX_UNITS = 200;
export const DEFAULT_LISTENING_UNITS = 100;
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
    nonUploadUnits: wholeNumber(env.YOUTUBE_NON_UPLOAD_DAILY_UNITS, DEFAULT_NON_UPLOAD_UNITS, 0),
    purposeCaps: {
      inbox: wholeNumber(env.INBOX_YOUTUBE_DAILY_UNITS, DEFAULT_INBOX_UNITS, 0),
      listening: wholeNumber(env.YOUTUBE_LISTENING_DAILY_UNITS, DEFAULT_LISTENING_UNITS, 0)
    }
  };
}

export function quotaLedgerFile(): string {
  return dataPath("youtube-quota.json");
}

type Stored = { day: string; units: PurposeUnits };

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
    purposeCaps: { ...config.purposeCaps },
    uploadReserve,
    nonUploadCapConfigured: config.nonUploadUnits,
    nonUploadAllowance,
    nonUploadClamped,
    nonUploadSpent,
    nonUploadRemaining: Math.max(0, Math.min(nonUploadAllowance - nonUploadSpent, config.dailyUnits - spent))
  };
}

type LegacyCounts = (day: string) => Promise<PurposeUnits>;

function roomFor(state: LedgerSnapshot, purpose: QuotaPurpose): number {
  if (purpose === "upload") return Math.max(0, state.dailyUnits - state.spent);
  const cap = state.purposeCaps[purpose];
  const capRoom = cap === undefined ? Number.POSITIVE_INFINITY : Math.max(0, cap - (state.byPurpose[purpose] ?? 0));
  return Math.min(state.nonUploadRemaining, capRoom);
}

export function createQuotaLedger(
  deps: { now?: () => Date; file?: () => string; config?: () => LedgerConfig; lockTimeoutMs?: number; legacy?: LegacyCounts } = {}
) {
  const now = deps.now ?? (() => new Date());
  const file = deps.file ?? quotaLedgerFile;
  const config = deps.config ?? (() => ledgerConfig());
  const lockOptions = () => ({ timeoutMs: deps.lockTimeoutMs ?? LEDGER_LOCK_TIMEOUT_MS });
  let warned = false;
  let migration: Promise<void> | undefined;

  function warnIfClamped(settings: LedgerConfig): void {
    const { nonUploadAllowance, nonUploadClamped, uploadReserve } = limits(settings);
    if (!nonUploadClamped || warned) return;
    warned = true;
    console.warn(
      `[youtube-quota] YOUTUBE_NON_UPLOAD_DAILY_UNITS=${settings.nonUploadUnits} would eat into the ${uploadReserve} units reserved for ` +
        `${settings.uploadsPerDay} uploads of ${settings.unitsPerUpload}; capped at ${nonUploadAllowance}.`
    );
  }

  async function carryOver(carried: PurposeUnits): Promise<boolean> {
    return withFileLock(
      file(),
      async () => {
        const settings = config();
        const day = quotaDate(now());
        const state = snapshotOf(await readStored(file()), day, settings);
        const units: PurposeUnits = { ...state.byPurpose };
        let raised = false;
        for (const [purpose, value] of Object.entries(carried) as Array<[QuotaPurpose, number]>) {
          if (!Number.isFinite(value) || value <= (units[purpose] ?? 0)) continue;
          units[purpose] = value;
          raised = true;
        }
        const next: Stored = { day, units };
        if (raised) await atomicWriteJson(file(), next);
        return raised;
      },
      lockOptions()
    );
  }

  function migrate(): Promise<void> {
    if (!deps.legacy) return Promise.resolve();
    const legacy = deps.legacy;
    migration ??= (async () => {
      await carryOver(await legacy(quotaDate(now())));
    })().catch(() => {
      migration = undefined;
    });
    return migration;
  }

  async function snapshot(): Promise<LedgerSnapshot> {
    const settings = config();
    warnIfClamped(settings);
    await migrate();
    return snapshotOf(await readStored(file()), quotaDate(now()), settings);
  }

  async function remaining(purpose: QuotaPurpose): Promise<number> {
    try {
      return roomFor(await snapshot(), purpose);
    } catch {
      return purpose === "upload" ? config().dailyUnits : 0;
    }
  }

  async function debit(units: number, purpose: QuotaPurpose): Promise<DebitResult> {
    const open = NEVER_REFUSED.includes(purpose);
    if (!Number.isInteger(units) || units <= 0) {
      return open ? { ok: true, remaining: 0, unmetered: true } : { ok: false, reason: "invalid-units", remaining: await remaining(purpose) };
    }
    if (!open) await migrate();
    try {
      return await withFileLock(
        file(),
        async (): Promise<DebitResult> => {
          const settings = config();
          warnIfClamped(settings);
          const day = quotaDate(now());
          const state = snapshotOf(await readStored(file()), day, settings);
          const room = roomFor(state, purpose);
          if (!open && units > room) return { ok: false, reason: "budget", remaining: room };
          const next: Stored = { day, units: { ...state.byPurpose, [purpose]: (state.byPurpose[purpose] ?? 0) + units } };
          await atomicWriteJson(file(), next);
          return { ok: true, remaining: Math.max(0, room - units) };
        },
        lockOptions()
      );
    } catch {
      return open ? { ok: true, remaining: 0, unmetered: true } : { ok: false, reason: "unavailable", remaining: 0 };
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

  return { debit, remaining, snapshot, carryOver, nextResetAt };
}

export type QuotaLedger = ReturnType<typeof createQuotaLedger>;

export const youtubeQuotaLedger: QuotaLedger = createQuotaLedger({ legacy: legacyUnitsFor });
