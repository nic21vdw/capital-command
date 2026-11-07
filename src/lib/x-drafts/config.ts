export type XDraftsConfig = {
  enabled: boolean;
  perDay: number;
  firstSlotMinutes: number;
  gapMinutes: number;
  threads: boolean;
  threadsOffsetMinutes: number;
  writeAheadHour: number;
  maxDaysAhead: number;
  minLeadMinutes: number;
  retryAfterMinutes: number;
};

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function num(name: string, fallback: number, min: number, max: number): number {
  const value = Number(env(name));
  if (!env(name) || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clock(name: string, fallback: number): number {
  const match = env(name).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 1440 ? minutes : fallback;
}

export function xDraftsConfig(): XDraftsConfig {
  return {
    enabled: env("X_DRAFTS").toLowerCase() === "on" || (env("X_DRAFTS").toLowerCase() !== "off" && env("NODE_ENV") !== "test"),
    perDay: num("X_DRAFTS_PER_DAY", 7, 1, 12),
    firstSlotMinutes: clock("X_DRAFTS_START", 8 * 60),
    gapMinutes: num("X_DRAFTS_GAP_MINUTES", 120, 30, 240),
    threads: env("X_DRAFTS_THREADS").toLowerCase() !== "off",
    threadsOffsetMinutes: num("X_DRAFTS_THREADS_OFFSET_MINUTES", 30, 0, 180),
    writeAheadHour: num("X_DRAFTS_WRITE_AHEAD_HOUR", 17, 0, 23),
    maxDaysAhead: num("X_DRAFTS_MAX_DAYS_AHEAD", 7, 1, 14),
    minLeadMinutes: num("X_DRAFTS_MIN_LEAD_MINUTES", 60, 5, 720),
    retryAfterMinutes: num("X_DRAFTS_RETRY_MINUTES", 120, 15, 1440)
  };
}
