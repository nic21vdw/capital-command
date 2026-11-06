import { primaryAccountId } from "@/lib/publisher/accounts";
import { LINKEDIN_KEYS } from "@/lib/publisher/linkedinKeys";
import { getCachedToken } from "@/lib/publisher/tokens";
import {
  PLATFORM_HEALTH_LABEL,
  RECONNECT_URL,
  accountDisplayName,
  type ExpiringPlatform
} from "@/lib/platform-health/types";

export const EXPIRY_WARNING_DAYS = 7;

const DAY_MS = 86_400_000;

async function numberAt(key: string): Promise<number | null> {
  const raw = await getCachedToken(key);
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function linkedinDeadline(): Promise<number | null> {
  if (!(await getCachedToken(LINKEDIN_KEYS.accessToken))) return null;
  if (await getCachedToken(LINKEDIN_KEYS.refreshToken)) return numberAt(LINKEDIN_KEYS.refreshExpiresAt);
  return numberAt(LINKEDIN_KEYS.accessExpiresAt);
}

export async function expiringConnections(now: Date = new Date()): Promise<ExpiringPlatform[]> {
  const found: ExpiringPlatform[] = [];
  const deadline = await linkedinDeadline();
  if (deadline !== null && deadline - now.getTime() <= EXPIRY_WARNING_DAYS * DAY_MS) {
    const expired = deadline <= now.getTime();
    const date = new Date(deadline).toISOString().slice(0, 10);
    found.push({
      platform: "linkedin",
      accountId: primaryAccountId("linkedin"),
      label: PLATFORM_HEALTH_LABEL.linkedin,
      displayName: accountDisplayName("linkedin", null),
      expiresAt: new Date(deadline).toISOString(),
      daysLeft: expired ? 0 : Math.ceil((deadline - now.getTime()) / DAY_MS),
      expired,
      reason: expired
        ? `The LinkedIn sign-in expired on ${date} and LinkedIn does not renew it by itself. Reconnect LinkedIn so scheduled posts can go out.`
        : `The LinkedIn sign-in expires on ${date} and LinkedIn does not renew it by itself. Reconnect LinkedIn before then so scheduled posts keep going out.`,
      fixUrl: RECONNECT_URL
    });
  }
  return found;
}
