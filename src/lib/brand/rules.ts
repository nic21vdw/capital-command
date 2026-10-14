import {
  DEFAULT_BRAND_KIT,
  brandKitSchema,
  channelContext,
  type BrandChannel,
  type BrandKit,
  type BrandKitOverrides
} from "@/lib/brand/defaults";

const overridesSchema = brandKitSchema.deepPartial();

export type BrandViolation = {
  kind: "banned-phrase" | "banned-claim" | "retired-name" | "avoid-word" | "dash" | "hashtag" | "emoji";
  match: string;
};

export type KitResolution = {
  kit: BrandKit;
  overrides: BrandKitOverrides;
  issues: string[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeValue(base: unknown, over: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(over)) return over;
  const merged: Record<string, unknown> = { ...base };
  for (const key of Object.keys(over)) {
    merged[key] = key in base ? mergeValue(base[key], over[key]) : over[key];
  }
  return merged;
}

export function mergeOverrides(base: BrandKitOverrides, patch: BrandKitOverrides): BrandKitOverrides {
  return mergeValue(base, patch) as BrandKitOverrides;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function pruneOverrides(base: unknown, overrides: unknown): BrandKitOverrides {
  if (!isPlainObject(overrides)) return {};
  const pruned: Record<string, unknown> = {};
  for (const key of Object.keys(overrides)) {
    const baseValue = isPlainObject(base) ? base[key] : undefined;
    const value = overrides[key];
    if (value === undefined || sameValue(baseValue, value)) continue;
    if (isPlainObject(value) && isPlainObject(baseValue)) {
      const nested = pruneOverrides(baseValue, value);
      if (Object.keys(nested).length > 0) pruned[key] = nested;
      continue;
    }
    pruned[key] = value;
  }
  return pruned;
}

export function resolveBrandKit(rawOverrides: unknown, base: BrandKit = DEFAULT_BRAND_KIT): KitResolution {
  if (rawOverrides === undefined || rawOverrides === null) return { kit: base, overrides: {}, issues: [] };
  const parsed = overridesSchema.safeParse(rawOverrides);
  if (!parsed.success) {
    return {
      kit: base,
      overrides: {},
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "kit"}: ${issue.message}`)
    };
  }
  const overrides = pruneOverrides(base, parsed.data);
  const merged = brandKitSchema.safeParse(mergeValue(base, overrides));
  if (!merged.success) {
    return {
      kit: base,
      overrides: {},
      issues: merged.error.issues.map((issue) => `${issue.path.join(".") || "kit"}: ${issue.message}`)
    };
  }
  return { kit: merged.data, overrides, issues: [] };
}

export function expandTokens(text: string, kit: BrandKit): string {
  return text
    .replaceAll("{name}", kit.identity.name)
    .replaceAll("{firstName}", kit.identity.firstName)
    .replaceAll("{handle}", kit.identity.handle)
    .replaceAll("{site}", kit.links.site);
}

export function stripDashes(text: string): string {
  return (
    text
      .replace(/^([ \t]*)[—–][ \t]*/gm, "$1- ")
      .replace(/(\d)[ \t]*[—–][ \t]*(\d)/g, "$1-$2")
      .replace(/[ \t]*[—–][ \t]*/g, ", ")
      .replace(/,[ \t]*,+/g, ",")
      .replace(/([,;:.!?])[ \t]*,/g, "$1")
      .replace(/,([ \t]*[.!?])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+$/gm, "")
      .trim()
  );
}

const PROTECTED = /(https?:\/\/\S+|www\.\S+|@[\w.]+|#\w+)/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phrasePattern(phrase: string, flags = "iu"): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}_])`, flags);
}

function mapUnprotected(text: string, change: (part: string) => string): string {
  return text
    .split(PROTECTED)
    .map((part, index) => (index % 2 === 0 ? change(part) : part))
    .join("");
}

function matchCase(source: string, replacement: string): string {
  return source.charAt(0) === source.charAt(0).toUpperCase() && source.charAt(0) !== source.charAt(0).toLowerCase()
    ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
    : replacement;
}

const UNPUBLISHED_FAMILIES = new Set(["voice", "script"]);

export function applyRules(kit: BrandKit, text: string, channel: BrandChannel): string {
  if (!text || UNPUBLISHED_FAMILIES.has(kit.channels[channel].family)) return text;
  let out = text;
  if (kit.voice.dashes === "strip") out = stripDashes(out);
  const wordmark = kit.logo.wordmark;
  const casing = /\bco-?lateral\b/gi;
  out = mapUnprotected(out, (part) => {
    let next = part.replace(casing, wordmark);
    for (const { from, to } of kit.voice.substitutions) {
      next = next.replace(phrasePattern(from, "giu"), (match) => matchCase(match, to));
    }
    return next;
  });
  return out.replace(/[ \t]+$/gm, "").trim();
}

function pictographs(text: string): string[] {
  return text.match(/\p{Extended_Pictographic}/gu) ?? [];
}

export function findViolations(kit: BrandKit, text: string, channel: BrandChannel): BrandViolation[] {
  const config = kit.channels[channel];
  const found: BrandViolation[] = [];
  const scan = (kind: BrandViolation["kind"], phrases: string[]) => {
    for (const phrase of phrases) {
      const hit = text.match(phrasePattern(phrase));
      if (hit) found.push({ kind, match: hit[0] });
    }
  };
  scan("banned-phrase", kit.voice.bannedPhrases);
  scan("banned-claim", kit.voice.claimTriggers);
  scan("retired-name", kit.voice.retiredNames.map((retired) => retired.name));
  scan("avoid-word", config.avoid);
  const dash = text.match(/[—–]/);
  if (dash && kit.voice.dashes === "strip") found.push({ kind: "dash", match: dash[0] });
  if (config.hashtags.max === 0) {
    const tag = text.match(/(?<![\w&])#[\p{L}\p{N}_]+/u);
    if (tag) found.push({ kind: "hashtag", match: tag[0] });
  }
  if (config.emoji === "none") {
    const emoji = pictographs(text)[0];
    if (emoji) found.push({ kind: "emoji", match: emoji });
  }
  return found;
}

export function hashtagPolicy(kit: BrandKit, channel: BrandChannel): { target: number; max: number; base: string[] } {
  const { target, max, base } = kit.channels[channel].hashtags;
  return { target, max, base: [...base] };
}

function bullets(items: string[], kit: BrandKit): string {
  return items.map((item) => `- ${expandTokens(item, kit)}`).join("\n");
}

function hashtagLine(kit: BrandKit, channel: BrandChannel): string {
  const policy = kit.channels[channel].hashtags;
  if (policy.max === 0) return "Hashtags: none.";
  const base = policy.base.length ? ` Always include ${policy.base.join(" ")}.` : "";
  return `Hashtags: about ${policy.target}, never more than ${policy.max}, with the # prefix, strongest first.${base}`;
}

function emojiLine(kit: BrandKit, channel: BrandChannel): string {
  const emoji = kit.channels[channel].emoji;
  if (emoji === "none") return "Emoji: none.";
  if (emoji === "sparing") return "Emoji: at most one, and only if it earns its place. No emoji spam.";
  return "Emoji: fine where they fit.";
}

export type PromptBlockOptions = { keywords?: boolean };

export function promptBlockFor(kit: BrandKit, channel: BrandChannel, options: PromptBlockOptions = {}): string {
  const config = kit.channels[channel];
  const products = kit.products.map((product) => `${product.name} (${product.oneLiner.replace(/\.$/, "")})`).join(" and ");
  const lines: string[] = [
    `Brand kit for this piece (${config.label}). Follow it exactly.`,
    `Who is speaking: ${expandTokens(channelContext(kit), kit)}`,
    `Products you may name: ${products}.`
  ];
  if (kit.voice.retiredNames.length > 0) {
    lines.push(
      `Retired names, never use them: ${kit.voice.retiredNames.map((retired) => `${retired.name} (now ${retired.use})`).join(", ")}.`
    );
  }
  if (config.guide) lines.push(`This channel: ${expandTokens(config.guide, kit)}`);
  const wantsKeywords = options.keywords ?? config.useKeywords;
  if (wantsKeywords && kit.vocabulary.keywords.length > 0) {
    lines.push(`Channel keywords, worked in only when the content genuinely supports them: ${kit.vocabulary.keywords.join(", ")}.`);
  }
  const voiceRules = [...kit.voice.rules, ...config.rules];
  if (voiceRules.length > 0) lines.push(`Voice:\n${bullets(voiceRules, kit)}`);
  if (kit.voice.dashes === "strip" && kit.voice.dashRule) lines.push(`Dashes: ${kit.voice.dashRule}`);
  if (kit.voice.bannedPhrases.length > 0) {
    lines.push(`Never use these words or phrases: ${kit.voice.bannedPhrases.join(", ")}.`);
  }
  if (config.avoid.length > 0) {
    lines.push(
      `${config.plainTalk ? "Ban these words on this channel, they read as jargon or as a model" : "Avoid on this channel"}: ${config.avoid.join(", ")}.`
    );
  }
  if (kit.voice.bannedClaims.length > 0) lines.push(`Claims:\n${bullets(kit.voice.bannedClaims, kit)}`);
  lines.push(hashtagLine(kit, channel), emojiLine(kit, channel));
  const cta = [config.cta.line, config.cta.url].filter(Boolean).join(": ");
  if (cta) lines.push(`Call to action and link target (use only where the task asks for a call to action): ${cta}`);
  return lines.join("\n");
}
