import { itemBelongsToAccount } from "@/lib/publisher/accounts";
import { isConnectionFailure } from "@/lib/publisher/failure";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";

/**
 * Whether an account that has credentials is, in fact, no longer working.
 *
 * "Connected" in the sidebar only ever meant that a token exists, so a revoked
 * YouTube token stayed green until a card on the board turned red. The queue
 * already knows better: the runner recorded why each post failed, and the board
 * classifies those reasons. This asks the same question of the account's most
 * recent finished post. If that one died on the connection, the account needs a
 * reconnect; if a later post went out, the connection evidently recovered.
 *
 * Only finished posts count. A `manual` post means nothing was connected when it
 * was scheduled, and a pending one has not been tried yet.
 */
export function needsReconnect(items: readonly QueueItem[], platform: PlatformId, accountId: string): boolean {
  let latestAt = -Infinity;
  let latestFailedOnConnection = false;
  for (const item of items) {
    if (!itemBelongsToAccount(item, platform, accountId)) continue;
    const state = item.platforms[platform];
    if (!state || (state.status !== "failed" && state.status !== "published")) continue;
    const at = Date.parse(state.status === "published" ? (state.publishedAt ?? item.publishAt) : item.publishAt);
    if (!Number.isFinite(at) || at < latestAt) continue;
    latestAt = at;
    latestFailedOnConnection = state.status === "failed" && isConnectionFailure(state);
  }
  return latestFailedOnConnection;
}
