import { publisherAccountLabel } from "@/lib/platform-health/account";
import { publisherAccountFingerprint } from "@/lib/platform-health/fingerprint";
import { clearAuthState, recordAuthRejection } from "@/lib/platform-health/store";
import type { PlatformId } from "@/lib/publisher/types";

export async function noteRefreshRejected(platform: PlatformId, accountId: string, error: unknown): Promise<void> {
  try {
    await recordAuthRejection(
      { platform, accountId, accountLabel: await publisherAccountLabel(platform, accountId) },
      error,
      { fingerprint: await publisherAccountFingerprint(platform, accountId) }
    );
  } catch {
    return;
  }
}

export async function noteRefreshAccepted(platform: PlatformId, accountId: string): Promise<void> {
  try {
    await clearAuthState(platform, accountId);
  } catch {
    return;
  }
}
