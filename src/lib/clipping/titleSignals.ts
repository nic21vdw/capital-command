// What a Short's title says that viewers respond to. Read off the channel's own
// results on 2026-11-17 (428 YouTube Shorts at least 14 days old, lifetime
// views): titles with a number had a median of 250 views against 177 without,
// and titles naming a model or tool 233 against 181. The weekly review uses
// this to point at a title worth a second look; it never rewrites one.

const NUMBER = /\d/;
const TOOL = /\b(claude|chatgpt|gpt[-\s]?\d*|codex|opus|sonnet|haiku|fable|grok|gemini|cursor|deepseek|kiro|copilot|roblox|obs|stripe|vercel|github)\b/i;

export type TitleSignals = { number: boolean; tool: boolean };

export function titleSignals(title: string): TitleSignals {
  return { number: NUMBER.test(title), tool: TOOL.test(title) };
}

/** A nudge for a title with neither, or null when it already names something specific. */
export function titleHint(title: string): string | null {
  const signals = titleSignals(title);
  if (signals.number || signals.tool) return null;
  return "No number or named tool. Your Shorts with one of those got more views.";
}

/** YouTube refuses a title over 100 characters. */
export const MAX_SHORT_TITLE = 100;

/** A title he typed, ready to book, or null when it cannot be used. */
export function cleanTypedTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.replace(/\s+/g, " ").trim();
  return title && title.length <= MAX_SHORT_TITLE ? title : null;
}
