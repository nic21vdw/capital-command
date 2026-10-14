type Stamped = { id: string; updatedAt?: string };

type Fields = Record<string, unknown>;

type Clash = (key: string, ours: unknown, other: unknown, base: unknown) => unknown;

const CARRIED_FIELDS = ["postId", "publishedAt", "uploadedAt", "updateIds"] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const isRecord = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);

export function snapshotById<T extends Stamped>(items: Iterable<T>): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const item of items) snapshot.set(item.id, JSON.stringify(item));
  return snapshot;
}

function delivered(leg: Fields): boolean {
  if (leg.status === "published" || Boolean(leg.postId) || Boolean(leg.publishedAt)) return true;
  return Array.isArray(leg.updateIds) && leg.updateIds.length > 0;
}

function attemptsOf(leg: Fields): number {
  return typeof leg.attempts === "number" ? leg.attempts : 0;
}

function mergeLeg(ours: Fields, other: Fields, mineWinsClash: boolean): Fields {
  const oursDelivered = delivered(ours);
  const otherDelivered = delivered(other);
  let mineWins = mineWinsClash;
  if (oursDelivered !== otherDelivered) mineWins = oursDelivered;
  else if (oursDelivered && (ours.status === "published") !== (other.status === "published")) mineWins = ours.status === "published";
  else if (attemptsOf(ours) !== attemptsOf(other)) mineWins = attemptsOf(ours) > attemptsOf(other);

  const winner = mineWins ? ours : other;
  const loser = mineWins ? other : ours;
  const merged: Fields = { ...winner };
  for (const key of CARRIED_FIELDS) {
    if (merged[key] === undefined && loser[key] !== undefined) merged[key] = loser[key];
  }
  return merged;
}

function mergeKeys(base: Fields, mine: Fields, theirs: Fields, onClash: Clash): Fields {
  const merged: Fields = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
    const ours = mine[key];
    const other = theirs[key];
    let pick: unknown;
    if (same(ours, other)) pick = ours;
    else if (same(ours, base[key])) pick = other;
    else if (same(other, base[key])) pick = ours;
    else pick = onClash(key, ours, other, base[key]);
    if (pick !== undefined) merged[key] = pick;
  }
  return merged;
}

function newest(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a >= b ? a : b;
}

function mergeItem<T extends Stamped>(was: string | undefined, mine: T, theirs: T): T {
  const baseFields = was === undefined ? {} : (JSON.parse(was) as Fields);
  delete baseFields.updatedAt;
  const { updatedAt: mineStamp, ...mineFields } = mine as Fields;
  const { updatedAt: theirStamp, ...theirFields } = theirs as Fields;
  const mineWinsClash = ((mineStamp as string | undefined) ?? "") >= ((theirStamp as string | undefined) ?? "");

  const legClash: Clash = (_leg, ours, other) =>
    isRecord(ours) && isRecord(other) ? mergeLeg(ours, other, mineWinsClash) : mineWinsClash ? ours : other;
  const itemClash: Clash = (key, ours, other, baseValue) => {
    if (!isRecord(ours) || !isRecord(other)) return mineWinsClash ? ours : other;
    if (key === "platforms") return mergeKeys(isRecord(baseValue) ? baseValue : {}, ours, other, legClash);
    if (key === "buffer") return mergeLeg(ours, other, mineWinsClash);
    return mineWinsClash ? ours : other;
  };

  const merged = mergeKeys(baseFields, mineFields, theirFields, itemClash);
  const stamp = newest(mineStamp as string | undefined, theirStamp as string | undefined);
  if (stamp !== undefined) merged.updatedAt = stamp;
  return merged as T;
}

export function mergeById<T extends Stamped>(
  base: ReadonlyMap<string, string>,
  mine: ReadonlyMap<string, T>,
  theirs: ReadonlyMap<string, T>
): Map<string, T> {
  const merged = new Map<string, T>();
  for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
    const was = base.get(id);
    const ours = mine.get(id);
    const other = theirs.get(id);

    if (was !== undefined && (!ours || !other)) continue;
    if (!ours) {
      merged.set(id, other as T);
      continue;
    }
    if (!other) {
      merged.set(id, ours);
      continue;
    }

    const oursJson = JSON.stringify(ours);
    const otherJson = JSON.stringify(other);
    if (oursJson === otherJson || otherJson === was) merged.set(id, ours);
    else if (oursJson === was) merged.set(id, other);
    else merged.set(id, mergeItem(was, ours, other));
  }
  return merged;
}
