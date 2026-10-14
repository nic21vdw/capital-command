import { RECONNECT_URL, authStateKey, type ExpiringPlatform, type PlatformHealthResponse } from "@/lib/platform-health/types";

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
  lead?: string;
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

function expiringHeadline(expiring: ExpiringPlatform[]): string {
  if (expiring.length > 1) return `${expiring.length} sign-ins are about to expire`;
  const [entry] = expiring;
  if (entry.expired) return `${entry.displayName} sign-in has expired`;
  return `${entry.displayName} sign-in expires in ${entry.daysLeft} day${entry.daysLeft === 1 ? "" : "s"}`;
}

export function bannerModel(
  response: PlatformHealthResponse | null | undefined,
  options: { now?: Date; timeZone?: string } = {}
): BannerModel {
  if (!response || !Array.isArray(response.broken)) return HIDDEN;
  const expiring = Array.isArray(response.expiring) ? response.expiring : [];
  if (response.broken.length === 0 && expiring.length === 0) return HIDDEN;
  const now = options.now ?? new Date();
  const brokenEntries: BannerEntry[] = response.broken.map((account) => ({
    key: authStateKey(account.platform, account.accountId),
    displayName: account.displayName || account.label,
    reason: shortReason(account.reason),
    sinceLabel: sinceLabel(account.since, options.timeZone),
    agoLabel: agoLabel(account.since, now, options.timeZone),
    fixUrl: internalLink(account.fixUrl),
    fixLabel: "Reconnect"
  }));
  const expiringEntries: BannerEntry[] = expiring.map((account) => ({
    key: authStateKey(account.platform, account.accountId),
    displayName: account.displayName || account.label,
    reason: shortReason(account.reason),
    sinceLabel: sinceLabel(account.expiresAt, options.timeZone),
    agoLabel: "",
    lead: `${account.expired ? "expired" : "expires"} ${sinceLabel(account.expiresAt, options.timeZone)}`,
    fixUrl: internalLink(account.fixUrl),
    fixLabel: "Reconnect"
  }));
  const headline =
    brokenEntries.length === 1
      ? `${brokenEntries[0].displayName} has stopped posting`
      : brokenEntries.length > 1
        ? `${brokenEntries.length} accounts have stopped posting`
        : expiringHeadline(expiring);
  return { visible: true, headline, entries: [...brokenEntries, ...expiringEntries] };
}
