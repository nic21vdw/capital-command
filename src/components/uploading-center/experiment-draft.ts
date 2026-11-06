import { MAX_VARIANTS, MIN_VARIANTS, type VariantOrigin } from "@/lib/experiments/types";
import type { PlatformId } from "@/lib/publisher/types";

export type DraftKind = "title" | "hook";
export type DraftVariant = { value: string; origin: VariantOrigin };

export function startingVariants(kind: DraftKind, baseTitle: string): DraftVariant[] {
  return [
    { value: kind === "title" ? baseTitle : "", origin: "original" },
    { value: "", origin: "edited" }
  ];
}

export function editVariant(variants: DraftVariant[], index: number, text: string, base: string): DraftVariant[] {
  const value = text.replace(/\n/g, " ");
  return variants.map((variant, position) => {
    if (position !== index) return variant;
    if (position === 0 && value === base) return { value, origin: "original" };
    return { value, origin: "edited" };
  });
}

export function addVariant(variants: DraftVariant[]): DraftVariant[] {
  return variants.length >= MAX_VARIANTS ? variants : [...variants, { value: "", origin: "edited" }];
}

export function removeVariant(variants: DraftVariant[], index: number): DraftVariant[] {
  return variants.length <= MIN_VARIANTS ? variants : variants.filter((_, position) => position !== index);
}

export function applySuggestions(variants: DraftVariant[], suggestions: string[]): DraftVariant[] {
  const out = variants.map((variant) => ({ ...variant }));
  const queue = [...suggestions];
  for (let index = 1; index < out.length && queue.length > 0; index += 1) {
    if (out[index].value.trim() === "") out[index] = { value: queue.shift()!, origin: "ai" };
  }
  while (queue.length > 0 && out.length < MAX_VARIANTS) out.push({ value: queue.shift()!, origin: "ai" });
  return out;
}

export function readyToStart(kind: DraftKind, variants: DraftVariant[], platforms: PlatformId[]): { ok: true } | { ok: false; reason: string } {
  if (platforms.length === 0) return { ok: false, reason: "Choose a platform on the card first." };
  if (variants.filter((variant) => variant.value.trim() !== "").length < MIN_VARIANTS) {
    return { ok: false, reason: "Write at least two variants to compare." };
  }
  if (kind === "hook" && platforms.includes("youtube")) {
    return { ok: false, reason: "A hook test cannot include YouTube, which will not take the same title twice. Pick another platform, or test titles." };
  }
  return { ok: true };
}

export type ExperimentRequestInput = {
  kind: DraftKind;
  clip: { jobId: string; clipId: string; file: string; headline: string };
  draft: { title: string; caption: string };
  variants: DraftVariant[];
  platforms: PlatformId[];
  accountIds: Partial<Record<PlatformId, string>>;
};

export function experimentRequest(input: ExperimentRequestInput) {
  const caption = input.draft.caption.trim();
  return {
    kind: input.kind,
    jobId: input.clip.jobId,
    clipId: input.clip.clipId,
    file: input.clip.file,
    sourceLabel: input.clip.headline,
    baseTitle: input.draft.title.trim(),
    ...(caption ? { baseCaption: caption } : {}),
    variants: input.variants.filter((variant) => variant.value.trim() !== "").map((variant) => ({ value: variant.value.trim(), origin: variant.origin })),
    platforms: input.platforms,
    accountIds: Object.fromEntries(input.platforms.flatMap((platform) => (input.accountIds[platform] ? [[platform, input.accountIds[platform]]] : [])))
  };
}
