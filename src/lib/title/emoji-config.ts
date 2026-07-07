import { readFileSync } from "node:fs";
import path from "node:path";

// Shared configuration for category-aware emoji injection. The on-disk config
// lives at `config/emoji_config.json` at the repo root; this module loads it
// once (cached) and falls back to a safe baked-in default if the file is
// missing or malformed, so a bad config can never crash the title pipeline.

export type EmojiMode = "contextual" | "always" | "off";
export type EmojiPosition = "prefix" | "suffix";

export type EmojiConfig = {
  /** Global kill switch. When false the decorator is a pure pass-through. */
  enabled: boolean;
  mode: EmojiMode;
  position: EmojiPosition;
  /** Hard cap on injected glyphs. The decorator never adds more than 1, but
   *  this is kept configurable and clamped defensively. */
  maxEmoji: number;
  /** Category → candidate glyphs. An empty list means "never decorate this
   *  category" (that is what `default` is for). */
  category_map: Record<string, string[]>;
  /** Glyphs used in `always` mode when the resolved category has no entries. */
  fallback: string[];
  /** Free-text keywords that map a raw content descriptor onto a category. */
  categoryKeywords: Record<string, string[]>;
};

/** The canonical "do nothing" config — also the shape callers get when the
 *  file can't be read. `enabled: true` mirrors the shipped config default. */
export const DEFAULT_EMOJI_CONFIG: EmojiConfig = {
  enabled: false,
  mode: "off",
  position: "prefix",
  maxEmoji: 1,
  category_map: { default: [] },
  fallback: [],
  categoryKeywords: {}
};

const CONFIG_PATH = path.join(process.cwd(), "config", "emoji_config.json");

let cached: EmojiConfig | null = null;

/** Normalizes an arbitrary parsed object into a well-formed EmojiConfig,
 *  filling any missing field from the default so downstream code never has to
 *  null-check. */
export function normalizeEmojiConfig(raw: unknown): EmojiConfig {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mode = obj.mode === "always" || obj.mode === "off" ? obj.mode : "contextual";
  const position = obj.position === "suffix" ? "suffix" : "prefix";
  const categoryMap =
    obj.category_map && typeof obj.category_map === "object"
      ? (obj.category_map as Record<string, unknown>)
      : {};
  const category_map: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(categoryMap)) {
    category_map[key] = Array.isArray(value) ? value.filter((g): g is string => typeof g === "string") : [];
  }
  if (!("default" in category_map)) category_map.default = [];

  const keywordsRaw =
    obj.categoryKeywords && typeof obj.categoryKeywords === "object"
      ? (obj.categoryKeywords as Record<string, unknown>)
      : {};
  const categoryKeywords: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(keywordsRaw)) {
    categoryKeywords[key] = Array.isArray(value)
      ? value.filter((k): k is string => typeof k === "string").map((k) => k.toLowerCase())
      : [];
  }

  return {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : false,
    mode,
    position,
    maxEmoji: typeof obj.maxEmoji === "number" && obj.maxEmoji >= 0 ? Math.floor(obj.maxEmoji) : 1,
    category_map,
    fallback: Array.isArray(obj.fallback) ? obj.fallback.filter((g): g is string => typeof g === "string") : [],
    categoryKeywords
  };
}

/**
 * Loads and caches the emoji config from disk. On any read/parse error it
 * returns the inert default (emoji disabled), guaranteeing the title pipeline
 * keeps working even with a missing or broken config file.
 */
export function loadEmojiConfig(): EmojiConfig {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    cached = normalizeEmojiConfig(parsed);
  } catch {
    cached = { ...DEFAULT_EMOJI_CONFIG };
  }
  return cached;
}

/** Test hook: drop the cached config so the next load re-reads disk. */
export function resetEmojiConfigCache(): void {
  cached = null;
}
