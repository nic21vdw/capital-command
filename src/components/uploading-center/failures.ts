import { describeFailure, isConnectionFailure } from "@/lib/publisher/failure";
import { failedLegPlatforms } from "@/lib/publisher/failedLegs";
import { ALL_PLATFORMS, type PlatformId, type PlatformState, type QueueItem } from "@/lib/publisher/types";

/**
 * The "Failed" strip: every platform leg that ended up failed, across ALL the
 * platform tabs and accounts, so a failure on Instagram is not found by
 * clicking through four tabs and a 14-day window. Pure, so the counts and the
 * connection-retry scope are tested without a browser.
 */

export type FailedLeg = {
  item: QueueItem;
  platform: PlatformId;
  state: PlatformState;
  /** The account the post belongs to (legacy items belong to the primary). */
  accountId: string;
  /** One plain sentence about what happened (failure.ts). */
  headline: string;
  /** A reconnect fixes this one, so "Retry connection failures" covers it. */
  connection: boolean;
};

/** Failed legs, oldest slot first so the one nearest to being missed leads. */
export function collectFailedLegs(items: QueueItem[]): FailedLeg[] {
  const legs: FailedLeg[] = [];
  for (const item of items) {
    for (const platform of failedLegPlatforms(item)) {
      const state = item.platforms[platform];
      if (!state) continue;
      legs.push({
        item,
        platform,
        state,
        accountId: item.accountId ?? `${platform}-primary`,
        headline: describeFailure(state, platform).headline,
        connection: isConnectionFailure(state)
      });
    }
  }
  return legs.sort((a, b) => a.item.publishAt.localeCompare(b.item.publishAt));
}

/** How many failed legs each platform tab has. */
export function failureCounts(legs: FailedLeg[]): Record<PlatformId, number> {
  const counts = Object.fromEntries(ALL_PLATFORMS.map((platform) => [platform, 0])) as Record<PlatformId, number>;
  for (const leg of legs) counts[leg.platform] += 1;
  return counts;
}

/** The platforms that have at least one failure a reconnect would fix. */
export function connectionFailurePlatforms(legs: FailedLeg[]): PlatformId[] {
  const platforms = new Set<PlatformId>();
  for (const leg of legs) if (leg.connection) platforms.add(leg.platform);
  return ALL_PLATFORMS.filter((platform) => platforms.has(platform));
}

/** "YouTube (2)" for a tab with failures, plain for one without. */
export function tabLabelWithFailures(label: string, failed: number): string {
  return failed > 0 ? `${label} (${failed} failed)` : label;
}
