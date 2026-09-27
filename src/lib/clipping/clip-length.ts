export type ClipLengthId = "quick" | "auto" | "standard" | "long";

export type ClipLengthBounds = { min: number; preferredMax: number; max: number };

export const CLIP_LENGTHS: Record<ClipLengthId, ClipLengthBounds & { label: string; hint: string }> = {
  quick: { label: "Quick", hint: "10-20s", min: 10, preferredMax: 20, max: 30 },
  auto: { label: "Auto", hint: "15-30s", min: 15, preferredMax: 30, max: 45 },
  standard: { label: "Standard", hint: "30-60s", min: 30, preferredMax: 60, max: 75 },
  long: { label: "Long", hint: "60-90s", min: 60, preferredMax: 90, max: 120 }
};

export const CLIP_LENGTH_IDS = Object.keys(CLIP_LENGTHS) as ClipLengthId[];

export const DEFAULT_CLIP_LENGTH: ClipLengthId = "auto";

export function isClipLengthId(value: unknown): value is ClipLengthId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CLIP_LENGTHS, value);
}

export function clipLengthBounds(id?: string): ClipLengthBounds {
  const { min, preferredMax, max } = CLIP_LENGTHS[isClipLengthId(id) ? id : DEFAULT_CLIP_LENGTH];
  return { min, preferredMax, max };
}
