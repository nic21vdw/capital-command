import { legUnsent } from "@/lib/publisher/approval";
import { localDateKey } from "@/lib/publisher/schedule";
import { isShortFormItem, shortVideoKey } from "@/lib/publisher/shortsCap";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";

export type ReleaseTarget = { id: string; platform: PlatformId };

export type ReleaseMove = ReleaseTarget & { publishAt: string; reason: "slot-too-old" | "day-full" };

export type ReleasePlan = {
  release: ReleaseTarget[];
  moves: ReleaseMove[];
  skipped: ReleaseTarget[];
};

export type ReleaseOptions = {
  now: Date;
  timeZone: string;
  slots: string[];
  dailyCap: (platform: PlatformId) => number;
  maxSlotAgeMs: number;
};

type Lane = { slots: Set<string>; days: Map<string, Set<string>> };

const laneKey = (target: ReleaseTarget) => `${target.id}:${target.platform}`;

function videoKeyOf(item: QueueItem): string {
  return shortVideoKey(item) ?? `item:${item.id}`;
}

export function planRelease(items: QueueItem[], targets: ReleaseTarget[], options: ReleaseOptions): ReleasePlan {
  const { now, timeZone, slots, dailyCap, maxSlotAgeMs } = options;
  const byId = new Map(items.map((item) => [item.id, item]));
  const wanted = new Map<string, ReleaseTarget>();
  const skipped: ReleaseTarget[] = [];
  for (const target of targets) {
    const leg = byId.get(target.id)?.platforms[target.platform];
    if (!leg || leg.approvedAt || !legUnsent(leg)) continue;
    wanted.set(laneKey(target), target);
  }

  const today = localDateKey(now, timeZone);
  const lanes = new Map<PlatformId, Lane>();
  const laneOf = (platform: PlatformId): Lane => {
    let lane = lanes.get(platform);
    if (!lane) {
      lane = { slots: new Set(), days: new Map() };
      lanes.set(platform, lane);
    }
    return lane;
  };
  const count = (platform: PlatformId, day: string, item: QueueItem) => {
    if (!isShortFormItem(item)) return;
    const lane = laneOf(platform);
    const videos = lane.days.get(day) ?? new Set<string>();
    videos.add(videoKeyOf(item));
    lane.days.set(day, videos);
  };
  const roomOn = (platform: PlatformId, day: string, item: QueueItem) => {
    if (!isShortFormItem(item)) return true;
    const videos = laneOf(platform).days.get(day);
    return (videos?.has(videoKeyOf(item)) ?? false) || (videos?.size ?? 0) < dailyCap(platform);
  };

  for (const item of items) {
    for (const platform of Object.keys(item.platforms) as PlatformId[]) {
      if (wanted.has(laneKey({ id: item.id, platform }))) continue;
      const leg = item.platforms[platform];
      if (!leg || leg.status === "failed" || leg.status === "manual") continue;
      laneOf(platform).slots.add(item.publishAt);
      const due = leg.status === "pending" && new Date(item.publishAt).getTime() <= now.getTime();
      count(platform, due ? today : localDateKey(item.publishAt, timeZone), item);
    }
  }

  const ordered = [...wanted.values()].sort((a, b) => {
    const left = byId.get(a.id)!.publishAt;
    const right = byId.get(b.id)!.publishAt;
    return left.localeCompare(right) || a.id.localeCompare(b.id) || a.platform.localeCompare(b.platform);
  });

  const release: ReleaseTarget[] = [];
  const moves: ReleaseMove[] = [];
  for (const target of ordered) {
    const item = byId.get(target.id)!;
    const lane = laneOf(target.platform);
    const slotAt = new Date(item.publishAt).getTime();
    if (slotAt > now.getTime()) {
      lane.slots.add(item.publishAt);
      count(target.platform, localDateKey(item.publishAt, timeZone), item);
      release.push(target);
      continue;
    }
    const stale = slotAt < now.getTime() - maxSlotAgeMs;
    if (!stale && roomOn(target.platform, today, item)) {
      count(target.platform, today, item);
      release.push(target);
      continue;
    }
    const slot = slots.find((candidate) => !lane.slots.has(candidate) && roomOn(target.platform, localDateKey(candidate, timeZone), item));
    if (!slot) {
      skipped.push(target);
      continue;
    }
    lane.slots.add(slot);
    count(target.platform, localDateKey(slot, timeZone), item);
    release.push(target);
    moves.push({ ...target, publishAt: slot, reason: stale ? "slot-too-old" : "day-full" });
  }
  return { release, moves, skipped };
}
