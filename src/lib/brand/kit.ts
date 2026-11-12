import { readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { DEFAULT_BRAND_KIT, channelContext, type BrandChannel, type BrandKit, type BrandKitOverrides } from "@/lib/brand/defaults";
import {
  applyRules,
  expandTokens,
  findViolations,
  hashtagPolicy,
  mergeOverrides,
  promptBlockFor,
  resolveBrandKit,
  stripHashtags,
  type BrandViolation,
  type KitResolution,
  type PromptBlockOptions
} from "@/lib/brand/rules";
import { dataPath } from "@/lib/paths";
import { atomicWriteJson } from "@/lib/storage/atomic-json";
import { withFileLock } from "@/lib/storage/file-lock";

export { BRAND_CHANNELS, DEFAULT_BRAND_KIT, isBrandChannel } from "@/lib/brand/defaults";
export type { BrandChannel, BrandKit, BrandKitOverrides } from "@/lib/brand/defaults";
export type { BrandViolation, KitResolution, PromptBlockOptions } from "@/lib/brand/rules";

export class BrandKitInvalidError extends Error {
  constructor(readonly issues: string[]) {
    super(`The brand kit was not saved: ${issues.slice(0, 3).join("; ")}`);
  }
}

export class BrandKitConflictError extends Error {}

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
  } catch (error) {
    cached = null;
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? defaultsResolution
      : { ...defaultsResolution, issues: ["The saved brand kit is unavailable. Retry before changing it."] };
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

export function applyBrandTitle(text: string, channel: BrandChannel): string {
  return applyRules(brandKit(), stripHashtags(text), channel);
}

export function brandViolations(text: string, channel: BrandChannel): BrandViolation[] {
  return findViolations(brandKit(), text, channel);
}

export function brandHashtagPolicy(channel: BrandChannel): { target: number; max: number; base: string[] } {
  return hashtagPolicy(brandKit(), channel);
}

export async function saveBrandKitOverrides(raw: unknown, expected?: unknown, patch = false): Promise<KitResolution> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new BrandKitInvalidError(["Send the overrides as an object."]);
  }
  const file = brandKitPath();
  return withFileLock(file, async () => {
    // Never replace an unreadable kit with defaults or overwrite a newer tab.
    let saved: unknown;
    try {
      saved = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new BrandKitConflictError("The saved brand kit could not be read. Repair or restore it before saving changes.");
      }
      saved = {};
    }
    if (typeof saved !== "object" || saved === null || Array.isArray(saved)) {
      throw new BrandKitConflictError("The saved brand kit needs repair before it can be changed.");
    }
    const current = resolveBrandKit(saved);
    if (current.issues.length) throw new BrandKitConflictError("The saved brand kit needs repair before it can be changed.");
    if (expected !== undefined && JSON.stringify(expected) !== JSON.stringify(current.overrides)) {
      throw new BrandKitConflictError("The brand kit changed elsewhere. Reload it and review your change again.");
    }
    const resolved = resolveBrandKit(patch ? mergeOverrides(current.overrides, raw as BrandKitOverrides) : raw);
    if (resolved.issues.length > 0) throw new BrandKitInvalidError(resolved.issues);
    await atomicWriteJson(file, resolved.overrides satisfies BrandKitOverrides);
    cached = null;
    return brandKitResolution();
  }, { timeoutMs: 10_000, reclaimLiveHolder: false });
}

export async function resetBrandKit(): Promise<KitResolution> {
  return saveBrandKitOverrides({});
}
