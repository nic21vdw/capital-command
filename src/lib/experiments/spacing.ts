import { PLATFORM_LABEL, type AnalyticsPlatform } from "@/lib/analytics/types";

const HOUR = 3_600_000;

export const VARIANT_GAP_MS = 48 * HOUR;

export type Placement = { variantId: string; platform: string; accountId: string; at: string };

export type SpacingConflict = {
  platform: string;
  accountId: string;
  first: Placement;
  second: Placement;
  gapHours: number;
};

export function spacingConflicts(placements: Placement[], gapMs: number = VARIANT_GAP_MS): SpacingConflict[] {
  const timed = placements
    .map((placement) => ({ placement, ms: Date.parse(placement.at) }))
    .filter((entry) => Number.isFinite(entry.ms))
    .sort((a, b) => a.ms - b.ms);
  const conflicts: SpacingConflict[] = [];
  for (let i = 0; i < timed.length; i += 1) {
    for (let j = i + 1; j < timed.length; j += 1) {
      const gap = timed[j].ms - timed[i].ms;
      if (gap >= gapMs) break;
      const a = timed[i].placement;
      const b = timed[j].placement;
      if (a.variantId === b.variantId || a.platform !== b.platform || a.accountId !== b.accountId) continue;
      conflicts.push({ platform: a.platform, accountId: a.accountId, first: a, second: b, gapHours: Math.round((gap / HOUR) * 10) / 10 });
    }
  }
  return conflicts;
}

function platformName(platform: string): string {
  return PLATFORM_LABEL[platform as AnalyticsPlatform] ?? platform;
}

export function spacingMessage(conflict: SpacingConflict, gapMs: number = VARIANT_GAP_MS): string {
  return (
    `Variants ${conflict.first.variantId} and ${conflict.second.variantId} would be on ${platformName(conflict.platform)} ` +
    `${conflict.gapHours} hours apart. Two variants of one video never share a platform within ${gapMs / HOUR} hours, ` +
    `because the second would be competing with the first for the same viewers.`
  );
}

export class VariantSpacingError extends Error {
  constructor(readonly conflicts: SpacingConflict[]) {
    super(conflicts.map((conflict) => spacingMessage(conflict)).join(" "));
    this.name = "VariantSpacingError";
  }
}

export function assertVariantSpacing(placements: Placement[], gapMs: number = VARIANT_GAP_MS): void {
  const conflicts = spacingConflicts(placements, gapMs);
  if (conflicts.length > 0) throw new VariantSpacingError(conflicts);
}
