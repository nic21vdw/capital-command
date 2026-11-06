import { VARIANT_GAP_MS } from "@/lib/experiments/spacing";
import type { ScheduleSlot } from "@/lib/publisher/slots";
import type { PlatformId } from "@/lib/publisher/types";

export type Leg = { platform: PlatformId; accountId: string };

export class NoRoomForVariantsError extends Error {
  constructor(count: number, gapMs: number) {
    super(
      `There is no room for ${count} variants: each one needs an open slot on every chosen platform, at least ${gapMs / 3_600_000} hours after the one before. ` +
        `Free up slots on the board or choose fewer platforms.`
    );
    this.name = "NoRoomForVariantsError";
  }
}

export function planVariantTimes(input: {
  count: number;
  slots: ScheduleSlot[];
  legs: Leg[];
  taken: (leg: Leg, slotUtc: string) => boolean;
  usable?: (slotUtc: string) => boolean;
  gapMs?: number;
}): string[] {
  const gapMs = input.gapMs ?? VARIANT_GAP_MS;
  const candidates = input.slots
    .filter((slot) => slot.bookable)
    .filter((slot) => (input.usable ? input.usable(slot.utc) : true))
    .filter((slot) => !input.legs.some((leg) => input.taken(leg, slot.utc)))
    .sort((a, b) => a.utc.localeCompare(b.utc));
  const planned: string[] = [];
  for (let index = 0; index < input.count; index += 1) {
    const earliest = planned.length === 0 ? -Infinity : Date.parse(planned[planned.length - 1]) + gapMs;
    const slot = candidates.find((candidate) => Date.parse(candidate.utc) >= earliest);
    if (!slot) throw new NoRoomForVariantsError(input.count, gapMs);
    planned.push(slot.utc);
  }
  return planned;
}
