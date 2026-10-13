import { currentFingerprints } from "@/lib/platform-health/fingerprint";
import { activeAuthStates } from "@/lib/platform-health/store";
import {
  HEALTH_PLATFORMS,
  PLATFORM_HEALTH_LABEL,
  type BrokenPlatform,
  type PlatformHealthResponse
} from "@/lib/platform-health/types";

export async function platformHealth(now: Date = new Date()): Promise<PlatformHealthResponse> {
  const states = await activeAuthStates(currentFingerprints());
  const broken: BrokenPlatform[] = states
    .sort((a, b) => HEALTH_PLATFORMS.indexOf(a.platform) - HEALTH_PLATFORMS.indexOf(b.platform))
    .map((state) => ({
      platform: state.platform,
      label: PLATFORM_HEALTH_LABEL[state.platform],
      since: state.since,
      lastFailureAt: state.lastFailureAt,
      reason: state.reason,
      fixUrl: state.fixUrl,
      failures: state.failures
    }));
  return { ok: broken.length === 0, checkedAt: now.toISOString(), broken };
}
