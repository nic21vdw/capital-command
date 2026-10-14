import { formatDistance } from "date-fns";

export type BackupStatus = {
  at: string;
  ok: boolean;
  path?: string;
  bytes?: number;
  fileCount?: number;
  error?: string;
  lastSuccessAt?: string;
};

export const BACKUP_STALE_HOURS = 48;

export type BackupView = { text: string; warning: boolean };

function parse(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function describeBackup(status: BackupStatus | null | undefined, now: Date = new Date()): BackupView {
  const lastGood = status ? parse(status.ok ? status.at : status.lastSuccessAt) : null;
  const age = lastGood ? formatDistance(lastGood, now, { addSuffix: true }) : "never";
  const failure = status && !status.ok ? ` / failed: ${status.error?.trim() || "unknown error"}` : "";
  const stale = !lastGood || now.getTime() - lastGood.getTime() > BACKUP_STALE_HOURS * 3_600_000;
  return { text: `Last backup: ${age}${failure}`, warning: stale || Boolean(failure) };
}
