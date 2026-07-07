import type { EmojiConfig } from "@/lib/title/emoji-config";

// Category-aware, single-emoji title decorator. This is the shared
// post-processing step both the long-form uploader and the short-form clip
// generator run over a freshly generated base title, so the two pipelines stay
// consistent. It is pure: given the same inputs (and RNG) it returns the same
// output, which makes the toggle-off path provably identical to pre-change
// behaviour and keeps the whole thing unit-testable.

export type DecorateResult = {
  /** The title after (possibly) prepending/appending one emoji. */
  decoratedTitle: string;
  /** Whether an emoji was actually injected. */
  emojiUsed: boolean;
  /** The glyph that was injected, or null when none was. */
  emojiChar: string | null;
};

export type DecorateOptions = {
  /** Injectable RNG (0..1) so selection is deterministic in tests. Defaults
   *  to Math.random, which gives the per-run variation the brief asks for. */
  random?: () => number;
};

// Matches a single emoji-ish grapheme: pictographic symbols and regional
// indicators. Used only to detect whether a base title ALREADY carries an
// emoji so we never double-decorate.
const EMOJI_DETECT = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/u;

/** True when the title already contains at least one emoji glyph. */
export function hasEmoji(title: string): boolean {
  return EMOJI_DETECT.test(title);
}

/**
 * Maps a raw content descriptor (a topic string, a project name, a category
 * slug, …) onto one of the configured category keys. Resolution order:
 *   1. absent/blank input                         → "default"
 *   2. exact key already in the category map       → that key
 *   3. any category keyword found in the text      → the first such category
 *   4. no match                                    → "default"
 * "default" is the deliberate "no emoji" bucket, so unknown input is inert.
 */
export function resolveCategory(raw: string | null | undefined, config: EmojiConfig): string {
  const value = (raw ?? "").trim();
  if (!value) return "default";
  const lower = value.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(config.category_map, lower)) return lower;
  for (const [category, keywords] of Object.entries(config.categoryKeywords)) {
    if (!config.category_map[category]?.length) continue;
    if (keywords.some((keyword) => lower.includes(keyword))) return category;
  }
  return "default";
}

/** Picks one glyph from a non-empty list using the (injectable) RNG. */
function pickEmoji(pool: string[], random: () => number): string {
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[index];
}

/**
 * The candidate glyphs to draw from.
 *  - A resolved category with entries always wins.
 *  - `always` mode falls back to the config's `fallback` pool when a category
 *    was supplied but couldn't be mapped (or maps to an empty list).
 *  - An absent/blank/explicit "default" category stays empty in every mode, so
 *    "no category → no emoji" and "default → unchanged" always hold.
 */
function candidatePool(resolved: string, rawProvided: boolean, config: EmojiConfig): string[] {
  const list = resolved === "default" ? [] : config.category_map[resolved] ?? [];
  if (list.length > 0) return list;
  if (config.mode === "always" && rawProvided) return config.fallback;
  return [];
}

/**
 * Decorates a base title with at most one category-appropriate emoji.
 *
 * Guarantees (see ACCEPTANCE CRITERIA):
 *  - `enabled: false` or `mode: "off"` → returns the title byte-for-byte.
 *  - A title that already has an emoji is never decorated (no doubling).
 *  - The "default" (or absent) category returns the title unchanged.
 *  - Never adds more than one glyph; the only length change is `glyph + space`.
 */
export function decorateTitle(
  title: string,
  category: string | null | undefined,
  config: EmojiConfig,
  options: DecorateOptions = {}
): DecorateResult {
  const unchanged: DecorateResult = { decoratedTitle: title, emojiUsed: false, emojiChar: null };

  if (!config.enabled || config.mode === "off" || config.maxEmoji < 1) return unchanged;
  if (hasEmoji(title)) return unchanged;

  // A meaningful, non-"default" category was supplied — this distinguishes an
  // unknown-but-provided category (eligible for the always-mode fallback) from
  // an absent or explicitly-default one (always left unchanged).
  const trimmedCategory = (category ?? "").trim();
  const rawProvided = trimmedCategory !== "" && trimmedCategory.toLowerCase() !== "default";
  const resolved = resolveCategory(category, config);
  const pool = candidatePool(resolved, rawProvided, config);
  if (pool.length === 0) return unchanged;

  const random = options.random ?? Math.random;
  const emoji = pickEmoji(pool, random);
  const trimmed = title.trim();
  const decoratedTitle = config.position === "suffix" ? `${trimmed} ${emoji}` : `${emoji} ${trimmed}`;

  return { decoratedTitle, emojiUsed: true, emojiChar: emoji };
}
