import { readFileSync, statSync } from "node:fs";
import { DEFAULT_BRAND_KIT, channelContext, type BrandChannel, type BrandKit, type BrandKitOverrides } from "@/lib/brand/defaults";
import {
  applyRules,
  expandTokens,
  findViolations,
  hashtagPolicy,
  promptBlockFor,
  resolveBrandKit,
  type BrandViolation,
  type KitResolution,
  type PromptBlockOptions
} from "@/lib/brand/rules";
import { dataPath } from "@/lib/paths";
import { atomicWriteJson } from "@/lib/storage/atomic-json";

export { BRAND_CHANNELS, DEFAULT_BRAND_KIT, isBrandChannel } from "@/lib/brand/defaults";
export type { BrandChannel, BrandKit, BrandKitOverrides } from "@/lib/brand/defaults";
export type { BrandViolation, KitResolution, PromptBlockOptions } from "@/lib/brand/rules";

export class BrandKitInvalidError extends Error {
  constructor(readonly issues: string[]) {
    super(`The brand kit was not saved: ${issues.slice(0, 3).join("; ")}`);
  }
}

export function brandKitPath(): string {
  return dataPath("brand-kit.json");
}

const defaultsResolution: KitResolution = { kit: DEFAULT_BRAND_KIT, overrides: {}, issues: [] };

let cached: { file: string; stamp: string; resolution: KitResolution } | null = null;

export function brandKitResolution(): KitResolution {
  const file = brandKitPath();
  let stamp: string;
  try {
    const info = statSync(file);
    stamp = `${info.mtimeMs}:${info.size}`;
  } catch {
    cached = null;
    return defaultsResolution;
  }
  if (cached && cached.file === file && cached.stamp === stamp) return cached.resolution;
  let resolution: KitResolution;
  try {
    const resolved = resolveBrandKit(JSON.parse(readFileSync(file, "utf8")));
    resolution = resolved;
  } catch {
    resolution = { ...defaultsResolution, issues: ["data/brand-kit.json could not be read, so the built-in defaults are in use."] };
  }
  cached = { file, stamp, resolution };
  return resolution;
}

export function brandKit(): BrandKit {
  return brandKitResolution().kit;
}

export function brandContext(): string {
  const kit = brandKit();
  return expandTokens(channelContext(kit), kit);
}

export function brandKeywords(): string[] {
  return [...brandKit().vocabulary.keywords];
}

export function brandProperNames(): string[] {
  return [...brandKit().vocabulary.properNames];
}

export function brandTitleExamples(): string[] {
  return [...brandKit().vocabulary.titleExamples];
}

export function brandPromptBlock(channel: BrandChannel, options?: PromptBlockOptions): string {
  return promptBlockFor(brandKit(), channel, options);
}

export function applyBrandRules(text: string, channel: BrandChannel): string {
  return applyRules(brandKit(), text, channel);
}

export function brandViolations(text: string, channel: BrandChannel): BrandViolation[] {
  return findViolations(brandKit(), text, channel);
}

export function brandHashtagPolicy(channel: BrandChannel): { target: number; max: number; base: string[] } {
  return hashtagPolicy(brandKit(), channel);
}

export async function saveBrandKitOverrides(raw: unknown): Promise<KitResolution> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new BrandKitInvalidError(["Send the overrides as an object."]);
  }
  const resolved = resolveBrandKit(raw);
  if (resolved.issues.length > 0) throw new BrandKitInvalidError(resolved.issues);
  await atomicWriteJson(brandKitPath(), resolved.overrides satisfies BrandKitOverrides);
  cached = null;
  return brandKitResolution();
}

export async function resetBrandKit(): Promise<KitResolution> {
  return saveBrandKitOverrides({});
}
