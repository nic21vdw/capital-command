import { RECONNECT_URL, authStateKey, type PlatformHealthResponse } from "@/lib/platform-health/types";

const DAY_MS = 86_400_000;
const MAX_BANNER_REASON = 160;

export type BannerEntry = {
  key: string;
  displayName: string;
  reason: string;
  sinceLabel: string;
  agoLabel: string;
  fixUrl: string;
  fixLabel: string;
};

export type BannerModel = {
  visible: boolean;
  headline: string;
  entries: BannerEntry[];
};

const HIDDEN: BannerModel = { visible: false, headline: "", entries: [] };

function sinceLabel(iso: string, timeZone?: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "an unknown date";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone }).format(time);
}

function agoLabel(iso: string, now: Date, timeZone?: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const day = (value: number) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(value);
  const days = Math.round((Date.parse(day(now.getTime())) - Date.parse(day(time))) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function internalLink(url: string): string {
  return url.startsWith("/") && !url.startsWith("//") ? url : RECONNECT_URL;
}

function shortReason(reason: string): string {
  return reason.length > MAX_BANNER_REASON ? `${reason.slice(0, MAX_BANNER_REASON - 1)}…` : reason;
}

export function bannerModel(
  response: PlatformHealthResponse | null | undefined,
  options: { now?: Date; timeZone?: string } = {}
): BannerModel {
  if (!response || !Array.isArray(response.broken) || response.broken.length === 0) return HIDDEN;
  const now = options.now ?? new Date();
  const entries = response.broken.map((account) => ({
    key: authStateKey(account.platform, account.accountId),
    displayName: account.displayName || account.label,
    reason: shortReason(account.reason),
    sinceLabel: sinceLabel(account.since, options.timeZone),
    agoLabel: agoLabel(account.since, now, options.timeZone),
    fixUrl: internalLink(account.fixUrl),
    fixLabel: "Reconnect"
  }));
  const headline =
    entries.length === 1 ? `${entries[0].displayName} has stopped posting` : `${entries.length} accounts have stopped posting`;
  return { visible: true, headline, entries };
}
