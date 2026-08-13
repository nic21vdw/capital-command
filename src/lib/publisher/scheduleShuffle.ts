import { shuffled } from "@/lib/publisher/mirror";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";

/**
 * Mixes upcoming posts across the slots they already occupy, so a week does not
 * read as one stream posted four days running.
 *
 * It only ever PERMUTES: the set of publish times is exactly the set that was
 * already booked, so nothing lands on a new day and the same-day rule in
 * `schedule.ts` cannot be reached from here.
 *
 * Two things a permutation can break, and both are constraints here rather than
 * hopes:
 *
 *   - ONE PLATFORM PER INSTANT. Several items legitimately share a publish time
 *     because `mirror.ts` deals each platform its own running order over the
 *     same slots. Moving items by time alone put two YouTube posts on one
 *     instant, which is the double-booking `queueOutputs.ts` exists to prevent.
 *     Occupancy is per platform AND account: two different Instagram accounts
 *     at one instant is the mirror working, not a collision.
 *
 *   - NO STREAM TWICE IN A ROW. The whole point of mixing is that consecutive
 *     slots come from different recordings, and an unconstrained shuffle only
 *     makes that likely. Items are placed against their neighbours, and what
 *     could not be separated is reported instead of being left to chance.
 *
 * Items the plan may not move (already uploaded to YouTube, when the caller says
 * so) still take part: they hold their platform at their instant and count as a
 * neighbour, so a move can never be planned into or next to them.
 */

export type ShuffleMove = {
  id: string;
  title: string;
  from: string;
  to: string;
};

export type ShuffleCollision = {
  publishAt: string;
  /** `platform@account` — the thing that would post twice at that instant. */
  occupant: string;
  itemIds: string[];
};

export type ShuffleRepeat = {
  publishAt: string;
  source: string;
  itemIds: string[];
};

export type ShufflePlan = {
  moves: ShuffleMove[];
  unchanged: number;
  /** Slots the plan could not clear — reported, never left silent. */
  collisions: ShuffleCollision[];
  /** Neighbouring slots still holding one stream. */
  repeats: ShuffleRepeat[];
};

export type ShuffleOptions = {
  seed?: number;
  /** Leave videos already uploaded to YouTube on the time YouTube itself holds. */
  onlyPending?: boolean;
  /**
   * Instants the plan may move a post ONTO that the queue is not using yet,
   * earliest first — the schedule grid, generated as far ahead as the caller
   * cares to look. Without these a repair can only permute what is already
   * booked, and a platform with more posts than instants then reads as
   * impossible when the answer is simply a later slot.
   */
  openSlots?: string[];
};

export function isUpcomingItem(item: QueueItem, now: Date): boolean {
  return new Date(item.publishAt).getTime() > now.getTime();
}

export function isYoutubeScheduled(item: QueueItem): boolean {
  const youtube = item.platforms?.youtube;
  return Boolean(youtube && youtube.status === "scheduled" && youtube.postId);
}

/**
 * What this post takes up at its instant. A failed platform is not holding
 * anything — same rule mirror uses when it decides a slot is free.
 */
export function occupancyOf(item: QueueItem): string[] {
  const account = item.accountId ?? "";
  const platforms = item.platforms ?? {};
  return (Object.keys(platforms) as PlatformId[])
    .filter((platform) => platforms[platform] && platforms[platform]!.status !== "failed")
    .map((platform) => `${platform}@${account}`);
}

/** The recording a post came from. Anything without one is its own stream. */
export function sourceOf(item: QueueItem): string {
  return item.jobId ?? `item:${item.id}`;
}

type Position = { publishAt: string; fixed?: QueueItem };

type Placed = { item: QueueItem; publishAt: string; fixed: boolean };

function fits(taken: Map<string, Set<string>>, publishAt: string, item: QueueItem): boolean {
  const held = taken.get(publishAt);
  if (!held) return true;
  return occupancyOf(item).every((key) => !held.has(key));
}

function claim(taken: Map<string, Set<string>>, publishAt: string, item: QueueItem): void {
  const held = taken.get(publishAt) ?? new Set<string>();
  for (const key of occupancyOf(item)) held.add(key);
  taken.set(publishAt, held);
}

function firstMatch(pool: QueueItem[], accept: (item: QueueItem) => boolean): number {
  for (let index = 0; index < pool.length; index += 1) {
    if (accept(pool[index])) return index;
  }
  return -1;
}

/**
 * Fills the open positions of a timeline from a pool, preferring in order: the
 * post's own slot (repairs only), a slot whose platforms are free, and a
 * neighbour from a different stream. The pool arrives shuffled, so taking the
 * first acceptable entry keeps the order random inside what the constraints
 * allow. A position with nothing acceptable left takes the next post anyway and
 * the caller reports it — a plan that silently dropped a post would be worse.
 */
function fill(positions: Position[], pool: QueueItem[]): Placed[] {
  const taken = new Map<string, Set<string>>();
  const remaining = [...pool];
  const placed: Placed[] = [];

  for (const position of positions) {
    if (position.fixed) {
      claim(taken, position.publishAt, position.fixed);
      placed.push({ item: position.fixed, publishAt: position.publishAt, fixed: true });
      continue;
    }
    const previous = placed[placed.length - 1]?.item;
    const free = (item: QueueItem) => fits(taken, position.publishAt, item);
    const apart = (item: QueueItem) => !previous || sourceOf(item) !== sourceOf(previous);

    let pick = firstMatch(remaining, (item) => free(item) && apart(item));
    if (pick < 0) pick = firstMatch(remaining, free);
    const [item] = remaining.splice(pick >= 0 ? pick : 0, 1);
    claim(taken, position.publishAt, item);
    placed.push({ item, publishAt: position.publishAt, fixed: false });
  }

  return placed;
}

/**
 * A repair's starting point: everything stays exactly where it is, and only the
 * posts that cannot (their platform is already taken at that instant) are lifted
 * off and dealt into the slots those same posts vacated.
 *
 * Re-dealing the whole schedule would fix the conflicts too, and did — 203 moves
 * to clear 123 conflicts, because pulling one post forward leaves its own slot
 * needing a filler and the displacement cascades through the calendar. A live
 * schedule is something he has already read; the fix has to be the small one.
 */
function park(upcoming: QueueItem[], pinned: Set<string>, pool: QueueItem[]): Placed[] {
  const taken = new Map<string, Set<string>>();
  const ordered = [...upcoming].sort((a, b) => a.publishAt.localeCompare(b.publishAt) || a.id.localeCompare(b.id));
  const kept: Placed[] = [];
  const parked: QueueItem[] = [];

  for (const item of ordered) {
    if (!pinned.has(item.id)) continue;
    claim(taken, item.publishAt, item);
    kept.push({ item, publishAt: item.publishAt, fixed: true });
  }
  for (const item of ordered) {
    if (pinned.has(item.id)) continue;
    if (!fits(taken, item.publishAt, item)) {
      parked.push(item);
      continue;
    }
    claim(taken, item.publishAt, item);
    kept.push({ item, publishAt: item.publishAt, fixed: false });
  }

  const openings = parked.map((item) => item.publishAt).sort((a, b) => a.localeCompare(b));
  const order = pool.filter((item) => parked.some((entry) => entry.id === item.id));
  const remaining = [...order];
  const placed = [...kept];
  for (const publishAt of openings) {
    let pick = firstMatch(remaining, (item) => fits(taken, publishAt, item));
    if (pick < 0) pick = 0;
    const [item] = remaining.splice(pick, 1);
    claim(taken, publishAt, item);
    placed.push({ item, publishAt, fixed: false });
  }

  return placed.sort((a, b) => a.publishAt.localeCompare(b.publishAt) || (a.fixed ? 0 : 1) - (b.fixed ? 0 : 1));
}

/**
 * The tail of a greedy pass can strand a post next to its own stream, because
 * by then it is the only one left. Swapping it with a post from elsewhere in
 * the schedule is what un-strands it, and a swap is only kept when it makes the
 * whole plan strictly better — so this can loosen a knot but never tie one.
 * Only the positions that are actually in trouble are tried, which is what
 * keeps a four-hundred-post queue cheap to repair.
 */
function separate(placed: Placed[], moveCost: number): Placed[] {
  const current = [...placed];
  const lanes = laneCounts(current);

  for (let pass = 0; pass < 30; pass += 1) {
    let improved = false;
    for (const index of troubled(current, lanes)) {
      if (current[index].fixed) continue;
      for (let other = 0; other < current.length; other += 1) {
        if (other === index || current[other].fixed) continue;
        if (swapDelta(current, lanes, index, other, moveCost) >= 0) continue;
        applySwap(current, lanes, index, other);
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }

  return current;
}

/** How many posts each `platform@account` has at each instant. */
function laneCounts(placed: Placed[]): Map<string, Map<string, number>> {
  const lanes = new Map<string, Map<string, number>>();
  for (const entry of placed) {
    const at = lanes.get(entry.publishAt) ?? new Map<string, number>();
    for (const lane of occupancyOf(entry.item)) at.set(lane, (at.get(lane) ?? 0) + 1);
    lanes.set(entry.publishAt, at);
  }
  return lanes;
}

function collidingLanes(at: Map<string, number> | undefined): number {
  if (!at) return 0;
  let total = 0;
  for (const count of at.values()) if (count > 1) total += 1;
  return total;
}

/**
 * What a swap would cost, counted only where it can change anything: the two
 * instants involved and the four neighbours around them. Scoring the whole
 * schedule per candidate swap is the obvious way to write this and takes forty
 * seconds on a four-hundred-post queue, which is not something a booking can
 * wait for.
 *
 * A slot posting twice on one platform dominates, a stream in two slots running
 * is next, and `moveCost` is what separates the callers: a repair pays for every
 * post it disturbs and so takes the smallest fix it can find, while a shuffle is
 * asked for movement and pays nothing.
 */
function swapDelta(
  placed: Placed[],
  lanes: Map<string, Map<string, number>>,
  index: number,
  other: number,
  moveCost: number
): number {
  const here = placed[index];
  const there = placed[other];
  let collisions = 0;
  if (here.publishAt !== there.publishAt) {
    collisions =
      collisionDelta(lanes, here.publishAt, here.item, there.item) +
      collisionDelta(lanes, there.publishAt, there.item, here.item);
  }

  const swapped = (position: number) =>
    position === index ? there.item : position === other ? here.item : placed[position].item;
  const repeats = repeatsAround(placed, index, other, swapped) - repeatsAround(placed, index, other, (position) => placed[position].item);

  const movesBefore =
    (here.item.publishAt === here.publishAt ? 0 : 1) + (there.item.publishAt === there.publishAt ? 0 : 1);
  const movesAfter =
    (there.item.publishAt === here.publishAt ? 0 : 1) + (here.item.publishAt === there.publishAt ? 0 : 1);

  return collisions * 10_000 + repeats * 100 + (movesAfter - movesBefore) * moveCost;
}

function collisionDelta(
  lanes: Map<string, Map<string, number>>,
  publishAt: string,
  leaving: QueueItem,
  arriving: QueueItem
): number {
  const at = lanes.get(publishAt);
  const trial = new Map(at ?? []);
  for (const lane of occupancyOf(leaving)) trial.set(lane, (trial.get(lane) ?? 0) - 1);
  for (const lane of occupancyOf(arriving)) trial.set(lane, (trial.get(lane) ?? 0) + 1);
  return collidingLanes(trial) - collidingLanes(at);
}

/** Back-to-back pairs on the four boundaries a swap can disturb. */
function repeatsAround(
  placed: Placed[],
  index: number,
  other: number,
  itemAt: (position: number) => QueueItem
): number {
  let total = 0;
  for (const edge of new Set([index - 1, index, other - 1, other])) {
    if (edge < 0 || edge + 1 >= placed.length) continue;
    if (sourceOf(itemAt(edge)) === sourceOf(itemAt(edge + 1))) total += 1;
  }
  return total;
}

function applySwap(
  placed: Placed[],
  lanes: Map<string, Map<string, number>>,
  index: number,
  other: number
): void {
  const here = placed[index];
  const there = placed[other];
  if (here.publishAt !== there.publishAt) {
    move(lanes, here.publishAt, here.item, there.item);
    move(lanes, there.publishAt, there.item, here.item);
  }
  placed[index] = { ...here, item: there.item };
  placed[other] = { ...there, item: here.item };
}

function move(
  lanes: Map<string, Map<string, number>>,
  publishAt: string,
  leaving: QueueItem,
  arriving: QueueItem
): void {
  const at = lanes.get(publishAt) ?? new Map<string, number>();
  for (const lane of occupancyOf(leaving)) at.set(lane, (at.get(lane) ?? 0) - 1);
  for (const lane of occupancyOf(arriving)) at.set(lane, (at.get(lane) ?? 0) + 1);
  lanes.set(publishAt, at);
}

/**
 * Gives a post that still cannot fit anywhere in the existing schedule a slot
 * of its own, earliest one first.
 *
 * A permutation cannot help here and saying so is not an answer: when 312
 * Facebook posts are spread over 278 instants, 34 of them have nowhere to be
 * until the schedule reaches further forward. It always can — the grid is three
 * slots a day for as long as the caller asks — so the overflow moves out rather
 * than stacking on a day that already posts.
 */
function relocate(placed: Placed[], lanes: Map<string, Map<string, number>>, openSlots: string[]): Placed[] {
  const candidates = [...new Set([...placed.map((entry) => entry.publishAt), ...openSlots])].sort((a, b) =>
    a.localeCompare(b)
  );
  if (candidates.length === 0) return placed;

  for (let index = 0; index < placed.length; index += 1) {
    const entry = placed[index];
    if (entry.fixed) continue;
    const at = lanes.get(entry.publishAt);
    const occupancy = occupancyOf(entry.item);
    if (!occupancy.some((lane) => (at?.get(lane) ?? 0) > 1)) continue;

    const target = candidates.find(
      (publishAt) =>
        publishAt !== entry.publishAt && occupancy.every((lane) => (lanes.get(publishAt)?.get(lane) ?? 0) === 0)
    );
    if (!target) continue;

    for (const lane of occupancy) at!.set(lane, (at!.get(lane) ?? 0) - 1);
    const moved = lanes.get(target) ?? new Map<string, number>();
    for (const lane of occupancy) moved.set(lane, (moved.get(lane) ?? 0) + 1);
    lanes.set(target, moved);
    placed[index] = { ...entry, publishAt: target };
  }

  return placed.sort((a, b) => a.publishAt.localeCompare(b.publishAt) || (a.fixed ? 0 : 1) - (b.fixed ? 0 : 1));
}

/** Positions taking part in a collision or a back-to-back pair. */
function troubled(placed: Placed[], lanes: Map<string, Map<string, number>>): number[] {
  const indexes: number[] = [];
  placed.forEach((entry, index) => {
    const at = lanes.get(entry.publishAt);
    const clashes = occupancyOf(entry.item).some((lane) => (at?.get(lane) ?? 0) > 1);
    const beside =
      (index > 0 && sourceOf(placed[index - 1].item) === sourceOf(entry.item)) ||
      (index + 1 < placed.length && sourceOf(placed[index + 1].item) === sourceOf(entry.item));
    if (clashes || beside) indexes.push(index);
  });
  return indexes;
}

function report(placed: Placed[]): {
  collisions: ShuffleCollision[];
  repeats: ShuffleRepeat[];
} {
  const byOccupant = new Map<string, string[]>();
  for (const { item, publishAt } of placed) {
    for (const key of occupancyOf(item)) {
      const at = `${publishAt}|${key}`;
      byOccupant.set(at, [...(byOccupant.get(at) ?? []), item.id]);
    }
  }
  const collisions: ShuffleCollision[] = [];
  for (const [at, itemIds] of byOccupant) {
    if (itemIds.length < 2) continue;
    const [publishAt, occupant] = at.split("|");
    collisions.push({ publishAt, occupant, itemIds });
  }

  const repeats: ShuffleRepeat[] = [];
  for (let index = 1; index < placed.length; index += 1) {
    const source = sourceOf(placed[index].item);
    if (source !== sourceOf(placed[index - 1].item)) continue;
    repeats.push({
      publishAt: placed[index].publishAt,
      source,
      itemIds: [placed[index - 1].item.id, placed[index].item.id]
    });
  }

  return { collisions: collisions.sort((a, b) => a.publishAt.localeCompare(b.publishAt)), repeats };
}

function movesFrom(
  placed: Placed[],
  movableIds: Set<string>
): {
  moves: ShuffleMove[];
  unchanged: number;
} {
  const moves: ShuffleMove[] = [];
  let unchanged = 0;
  for (const { item, publishAt } of placed) {
    if (!movableIds.has(item.id)) continue;
    if (item.publishAt === publishAt) {
      unchanged += 1;
      continue;
    }
    moves.push({ id: item.id, title: item.title, from: item.publishAt, to: publishAt });
  }
  return { moves, unchanged };
}

function timeline(
  items: QueueItem[],
  now: Date,
  movableId: (item: QueueItem) => boolean
): { positions: Position[]; pool: QueueItem[] } {
  const upcoming = items.filter((item) => isUpcomingItem(item, now));
  const pool = upcoming.filter(movableId);
  const pinned = upcoming.filter((item) => !movableId(item));
  const positions: Position[] = [
    ...pinned.map((item): Position => ({ publishAt: item.publishAt, fixed: item })),
    ...pool.map((item): Position => ({ publishAt: item.publishAt }))
  ].sort(
    (a, b) => a.publishAt.localeCompare(b.publishAt) || (a.fixed ? 0 : 1) - (b.fixed ? 0 : 1)
  );
  return { positions, pool };
}

function emptyPlan(): ShufflePlan {
  return { moves: [], unchanged: 0, collisions: [], repeats: [] };
}

export function planScheduleShuffle(items: QueueItem[], now: Date, options: ShuffleOptions = {}): ShufflePlan {
  const movable = (item: QueueItem) => !(options.onlyPending && isYoutubeScheduled(item));
  const { positions, pool } = timeline(items, now, movable);
  if (pool.length === 0) return emptyPlan();
  const placed = separate(fill(positions, shuffled(pool, options.seed ?? Date.now())), 0);
  return { ...movesFrom(placed, new Set(pool.map((item) => item.id))), ...report(placed) };
}

/**
 * The smallest set of moves that clears the double-bookings, leaving every post
 * that is already fine — and every video already uploaded to YouTube — exactly
 * where it is. Use this on a schedule that is live; `planScheduleShuffle` is for
 * a schedule you mean to re-order.
 */
export function planScheduleRepair(items: QueueItem[], now: Date, options: ShuffleOptions = {}): ShufflePlan {
  const upcoming = items.filter((item) => isUpcomingItem(item, now));
  const pinned = new Set(upcoming.filter(isYoutubeScheduled).map((item) => item.id));
  const pool = upcoming.filter((item) => !pinned.has(item.id));
  if (pool.length === 0) return emptyPlan();
  const parked = separate(park(upcoming, pinned, shuffled(pool, options.seed ?? Date.now())), 1);
  const spread = relocate(parked, laneCounts(parked), options.openSlots ?? []);
  const placed = separate(spread, 1);
  return { ...movesFrom(placed, new Set(pool.map((item) => item.id))), ...report(placed) };
}

export function applyScheduleShuffle(items: QueueItem[], plan: ShufflePlan): QueueItem[] {
  const nextTime = new Map(plan.moves.map((move) => [move.id, move.to]));
  return items.map((item) => {
    const to = nextTime.get(item.id);
    return to ? { ...item, publishAt: to } : item;
  });
}

/**
 * How many upcoming posts want each lane, against how many instants there are
 * to put them in. A lane wanting more posts than there are instants CANNOT be
 * separated by any re-ordering — the schedule needs more slots, or fewer posts
 * on that platform. Without this the leftovers read as a solver that gave up.
 */
export function laneDemand(
  items: QueueItem[],
  now: Date
): { instants: number; lanes: Array<{ lane: string; wanted: number; over: number }> } {
  const upcoming = items.filter((item) => isUpcomingItem(item, now));
  const instants = new Set(upcoming.map((item) => item.publishAt)).size;
  const wanted = new Map<string, number>();
  for (const item of upcoming) {
    for (const lane of occupancyOf(item)) wanted.set(lane, (wanted.get(lane) ?? 0) + 1);
  }
  return {
    instants,
    lanes: [...wanted.entries()]
      .map(([lane, count]) => ({ lane, wanted: count, over: count - instants }))
      .sort((a, b) => b.over - a.over)
  };
}

export function describeSchedulePlan(plan: ShufflePlan): string {
  const parts = [
    `${plan.moves.length} post${plan.moves.length === 1 ? "" : "s"} move`,
    `${plan.unchanged} stay put`
  ];
  if (plan.collisions.length > 0) parts.push(`${plan.collisions.length} slot conflict(s) could not be cleared`);
  if (plan.repeats.length > 0) parts.push(`${plan.repeats.length} back-to-back from one stream`);
  return parts.join(", ");
}
