import { currentFingerprint } from "@/lib/platform-health/fingerprint";
import { activeAuthStates } from "@/lib/platform-health/store";
import {
  HEALTH_PLATFORMS,
  PLATFORM_HEALTH_LABEL,
  accountDisplayName,
  type BrokenPlatform,
  type PlatformHealthResponse
} from "@/lib/platform-health/types";

export async function platformHealth(now: Date = new Date()): Promise<PlatformHealthResponse> {
  const states = await activeAuthStates(currentFingerprint);
  const broken: BrokenPlatform[] = states
    .sort(
      (a, b) =>
        HEALTH_PLATFORMS.indexOf(a.platform) - HEALTH_PLATFORMS.indexOf(b.platform) ||
        a.since.localeCompare(b.since)
    )
    .map((state) => ({
      platform: state.platform,
      accountId: state.accountId,
      label: PLATFORM_HEALTH_LABEL[state.platform],
      displayName: accountDisplayName(state.platform, state.accountLabel),
      since: state.since,
      lastFailureAt: state.lastFailureAt,
      reason: state.reason,
      fixUrl: state.fixUrl,
      failures: state.failures
    }));
  return { ok: broken.length === 0, checkedAt: now.toISOString(), broken };
}
