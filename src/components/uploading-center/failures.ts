import { PLATFORM_LABELS, describeFailure, duplicateTitleCleared, isConnectionFailure } from "@/lib/publisher/failure";
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
      const advice = describeFailure(state, platform);
      legs.push({
        item,
        platform,
        state,
        accountId: item.accountId ?? `${platform}-primary`,
        headline:
          advice.kind === "duplicate-title" && duplicateTitleCleared(state.error, item.title)
            ? "Renamed since - ready to retry from its card."
            : advice.headline,
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

/** "TikTok", "TikTok and Instagram", "YouTube, TikTok and Instagram". */
export function platformList(platforms: PlatformId[]): string {
  const names = platforms.map((platform) => PLATFORM_LABELS[platform]);
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** One account's worth of failures the bulk retry can actually put back. */
export type ConnectionRetryTarget = { platform: PlatformId; accountId: string; count: number };

/**
 * What "retry the connection failures" can really do right now.
 *
 * The button used to count every failure a reconnect WOULD fix, whether or not
 * anything had been reconnected, so with TikTok still unconnected it re-armed
 * three posts, they failed again, and the toast said "Nothing was put back".
 * Each leg is now sorted by whether its own account has a connection today:
 *
 * - `targets`        connected account, slot recent enough to post: these go back
 * - `needConnection` no connection yet: retrying only fails the same way again
 * - `tooOld`         connected, but the slot is more than a day gone (re-armed it
 *                    would post at once, long after the slot): left for one-by-one
 *
 * Pure, so the rules are tested here and the strip only draws the answer.
 */
export type ConnectionRetryPlan = {
  targets: ConnectionRetryTarget[];
  /** Legs `targets` will put back. */
  count: number;
  needConnection: PlatformId[];
  tooOld: number;
};

export function planConnectionRetry(
  legs: FailedLeg[],
  options: {
    isConnected: (platform: PlatformId, accountId: string) => boolean;
    now: Date;
    maxSlotAgeHours: number;
  }
): ConnectionRetryPlan {
  const targets = new Map<string, ConnectionRetryTarget>();
  const needConnection = new Set<PlatformId>();
  let tooOld = 0;
  const cutoff = options.now.getTime() - options.maxSlotAgeHours * 3_600_000;
  for (const leg of legs) {
    if (!leg.connection) continue;
    if (!options.isConnected(leg.platform, leg.accountId)) {
      needConnection.add(leg.platform);
      continue;
    }
    const slot = new Date(leg.item.publishAt).getTime();
    if (Number.isFinite(slot) && slot < cutoff) {
      tooOld += 1;
      continue;
    }
    const key = `${leg.platform}:${leg.accountId}`;
    const target = targets.get(key) ?? { platform: leg.platform, accountId: leg.accountId, count: 0 };
    target.count += 1;
    targets.set(key, target);
  }
  const list = [...targets.values()];
  return {
    targets: list,
    count: list.reduce((sum, target) => sum + target.count, 0),
    needConnection: ALL_PLATFORMS.filter((platform) => needConnection.has(platform)),
    tooOld
  };
}

/** The button's own words: it says how many posts it will put back. */
export function retryConnectionLabel(count: number): string {
  if (count <= 0) return "Retry posts that lost their connection";
  return count === 1 ? "Retry 1 post that lost its connection" : `Retry ${count} posts that lost their connection`;
}

/**
 * The line under the button when it cannot (or cannot fully) do its job. Null
 * when there is nothing to add.
 */
export function retryConnectionHelp(plan: ConnectionRetryPlan): string | null {
  if (plan.needConnection.length > 0) {
    const names = platformList(plan.needConnection);
    return plan.count > 0
      ? `${names} still ${plan.needConnection.length === 1 ? "needs" : "need"} connecting before ${plan.needConnection.length === 1 ? "its" : "their"} posts can be retried.`
      : `Connect ${names} first, then retry.`;
  }
  if (plan.count === 0 && plan.tooOld > 0) {
    return `${plan.tooOld === 1 ? "That post is" : `Those ${plan.tooOld} posts are`} more than a day past ${plan.tooOld === 1 ? "its" : "their"} slot - retry from the card instead.`;
  }
  return null;
}

/** What one platform's bulk retry answered (summed over its accounts). */
export type RearmPlatformResult = { platform: PlatformId; recovered: number; skippedOld: number; error?: string };

const posts = (count: number) => `${count} post${count === 1 ? "" : "s"}`;

/**
 * The toast after a bulk retry: exactly what happened, platform by platform.
 * "Put 3 back" with no word about the fourth that was refused is how the old one
 * read as a success while nothing posted.
 */
export function describeRearmResults(results: RearmPlatformResult[]): {
  tone: "success" | "warning" | "error";
  message: string;
} {
  if (results.length === 0) return { tone: "error", message: "Nothing was waiting on a connection." };
  const lines: string[] = [];
  let recovered = 0;
  let trouble = false;
  for (const result of results) {
    recovered += result.recovered;
    const parts: string[] = [];
    if (result.recovered > 0) parts.push(`${posts(result.recovered)} back in the queue (they go out on the next publisher pass)`);
    if (result.skippedOld > 0) {
      parts.push(`${result.skippedOld === 1 ? "1 older post" : `${result.skippedOld} older posts`} left failed - retry from the card`);
      trouble = true;
    }
    if (result.error) {
      parts.push(result.recovered > 0 ? `then it stopped: ${result.error}` : result.error);
      trouble = true;
    }
    if (parts.length === 0) parts.push("nothing was waiting on a connection");
    lines.push(`${PLATFORM_LABELS[result.platform]}: ${parts.join("; ")}.`);
  }
  const message = lines.join(" ");
  if (recovered === 0) {
    const onlyError = results.every((result) => result.error);
    return { tone: onlyError ? "error" : "warning", message: `Nothing was put back. ${message}` };
  }
  return { tone: trouble ? "warning" : "success", message };
}
