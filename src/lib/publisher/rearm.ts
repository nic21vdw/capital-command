import { itemBelongsToAccount } from "@/lib/publisher/accounts";
import { isConnectionFailure } from "@/lib/publisher/failure";
import type { PlatformId, PlatformState, PlatformStatus, QueueItem } from "@/lib/publisher/types";

/**
 * Un-blocking scheduled posts.
 *
 * Two of the per-platform terminal states are terminal only because of
 * something outside the post: `manual` means the account wasn't connected when
 * it was scheduled, and a `failed` whose reason is a dead token means the
 * connection lapsed. Both stop being true the moment that account is
 * connected, and neither should cost a re-scheduled clip.
 *
 * The transitions live here, pure over the item, so the rules are tested
 * without a queue file: the queue, the API's retry action and the YouTube
 * connect callback re-arm through this one function instead of hand-rolling
 * the reset.
 *
 * A re-arm deliberately keeps `postId`. That id is the proof the post already
 * exists on the platform, and the runner reads it before it uploads anything —
 * so a retry on a post that DID reach the platform resumes it (verify/flip
 * public) instead of uploading a second copy of the same video.
 */

/** Terminal-for-now states a re-arm may put back to pending. */
export type RearmableStatus = Extract<PlatformStatus, "failed" | "manual">;

export const DEFAULT_REARM_STATUSES: RearmableStatus[] = ["failed", "manual"];

export type RearmScope = {
  /** Only this platform (default: every platform on the item). */
  platform?: PlatformId;
  /** Only posts belonging to this account of that platform. */
  accountId?: string;
  /** Which blocked states to revive (default: both). */
  statuses?: RearmableStatus[];
  /**
   * Extra gate on the failure reason, so a reconnect revives the uploads that
   * failed for THAT reason and leaves other permanent failures alone.
   */
  where?: (state: PlatformState, platform: PlatformId) => boolean;
};

/**
 * The scope a connect/reconnect flow re-arms with: this account's posts on this
 * platform, but only the ones that were waiting on the connection. A video the
 * platform itself rejected is just as rejected after a reconnect.
 */
export function connectRearmScope(platform: PlatformId, accountId?: string): RearmScope {
  return { platform, accountId, where: (state) => isConnectionFailure(state) };
}

function isRearmable(status: PlatformStatus, statuses: RearmableStatus[]): status is RearmableStatus {
  return (statuses as PlatformStatus[]).includes(status);
}

/** Puts the scoped blocked platforms of one item back to pending. */
export function rearmItem(item: QueueItem, scope: RearmScope = {}): PlatformId[] {
  const statuses = scope.statuses ?? DEFAULT_REARM_STATUSES;
  const revived: PlatformId[] = [];
  for (const [platform, state] of Object.entries(item.platforms) as [PlatformId, PlatformState][]) {
    if (!state) continue;
    if (scope.platform && platform !== scope.platform) continue;
    if (!isRearmable(state.status, statuses)) continue;
    if (scope.accountId && !itemBelongsToAccount(item, platform, scope.accountId)) continue;
    if (scope.where && !scope.where(state, platform)) continue;

    state.status = "pending";
    state.attempts = 0;
    state.error = undefined;
    state.note = undefined;
    state.nextAttemptAt = undefined;
    state.claimedAt = undefined;
    revived.push(platform);
  }
  // The failure clock only means anything while the item is still failed.
  if (revived.length > 0) item.failedSeenAt = undefined;
  return revived;
}

/** The same across a whole queue: which items came back, and on what. */
export function rearmItems(
  items: QueueItem[],
  scope: RearmScope = {}
): Array<{ item: QueueItem; platforms: PlatformId[] }> {
  const changed: Array<{ item: QueueItem; platforms: PlatformId[] }> = [];
  for (const item of items) {
    const platforms = rearmItem(item, scope);
    if (platforms.length > 0) changed.push({ item, platforms });
  }
  return changed;
}

/** True when any platform of the item is blocked and could be re-armed. */
export function hasRearmablePlatform(item: QueueItem, statuses: RearmableStatus[] = DEFAULT_REARM_STATUSES): boolean {
  return Object.values(item.platforms).some((state) => state && isRearmable(state.status, statuses));
}
