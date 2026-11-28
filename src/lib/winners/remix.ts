import { brandPromptBlock } from "@/lib/brand/kit";
import { addDaysToDateKey, earliestPublishDateKey, localDateKey } from "@/lib/publisher/schedule";
import { draftProblem } from "@/lib/x-drafts/generator";
import { breaksPersona, X_FACTS, X_VOICE_RULES } from "@/lib/x-drafts/voice";
import type { Remix, RetestPlan, ShortScript, Winner } from "@/lib/winners/types";

export const RETEST_WITHIN_DAYS = 7;
export const THREADS_MAX = 500;
export const SHORT_MAX_WORDS = 120;
export const SHORT_MAX_LINES = 8;

const LINK = /\b(?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)+(?:com|org|net|io|ai|dev|app|co)\b)/i;
const DASHES = /[–—]/;

export const REMIX_SYSTEM = [
  "You remake one of Nic's posts that clearly beat his usual numbers into three new pieces, each opening on a NEW hook.",
  "The idea and the facts stay the same. Only the angle and the opening change, so the retest tells him whether the idea or the original hook did the work.",
  "Return strict JSON only, no prose:",
  '{"angle": string, "short": {"hook": string, "lines": string[], "cta": string, "headlines": string[], "broll": string[]}, "threads": string, "tweet": string, "retestHook": string, "flags": string[]}',
  "short: a 25 to 40 second script Nic records himself. hook is the first spoken line, under 12 words. lines are 3 to 6 short spoken lines (question, proof, answer). cta is his spoken sign-off ending on 'let me know in the comments'. headlines is one 2 or 3 word on-screen headline per line. broll names real screen captures to show, never stock footage.",
  "threads: one post up to 500 characters, warmer and more conversational than the tweet, different first line from the tweet.",
  "tweet: one post up to 480 characters following the X rules below.",
  "retestHook: a second, different first line for the same Short, for the retest.",
  "flags: anything you could not verify from the source, or any line you derived rather than took from what he said. Empty if none.",
  "Never invent numbers, results or events. Never put a link in any piece. No hashtags, no emoji, no em dashes.",
  "Never call CoLateral engineering or structural software, and never mention selling to engineering firms.",
  "",
  "X rules:",
  ...X_VOICE_RULES.map((rule) => `- ${rule}`),
  "",
  "Facts you may use:",
  ...X_FACTS.map((fact) => `- ${fact}`)
].join("\n");

export function remixPrompt(winner: Winner, source: string | null): string {
  const proof = winner.evidence
    .map((item) => `${item.platform}: ${item.value} ${item.metric} at ${item.ageDays} days, ${item.ratio}x the median of ${item.peers} posts`)
    .join("; ");
  return [
    brandPromptBlock("x"),
    "",
    `Original title: ${winner.title}`,
    `Original caption: ${winner.caption}`,
    source ? `What he said in it: ${source}` : "What he said in it: not available. Stay inside what the title and caption claim, and flag it.",
    `Why it is a winner: ${proof}`
  ].join("\n");
}

export function retestPlan(now: Date, timeZone: string, hook: string): RetestPlan {
  return {
    from: earliestPublishDateKey(now, timeZone),
    by: addDaysToDateKey(localDateKey(now, timeZone), RETEST_WITHIN_DAYS),
    hook,
    note: "Book only after Nic types his go in the thread doing the booking. One Short per day on the publisher."
  };
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
}

export function sameHook(a: string, b: string): boolean {
  const left = normalize(a).split(" ").slice(0, 4).join(" ");
  const right = normalize(b).split(" ").slice(0, 4).join(" ");
  return left.length > 0 && left === right;
}

export function remixProblems(remix: Remix, winner: Pick<Winner, "title">): string[] {
  const problems: string[] = [];
  const tweetProblem = draftProblem(remix.tweet);
  if (tweetProblem) problems.push(`tweet: ${tweetProblem}`);
  if (remix.threads.length > THREADS_MAX) problems.push("threads: too long");
  if (LINK.test(remix.threads)) problems.push("threads: has a link");
  if (breaksPersona(remix.threads)) problems.push("threads: talks about engineering work");
  if (sameHook(remix.threads, remix.tweet)) problems.push("threads: opens like the tweet");
  const short = remix.short;
  const spoken = [short.hook, ...short.lines, short.cta].join(" ");
  if (short.lines.length === 0 || short.lines.length > SHORT_MAX_LINES) problems.push("short: needs 1 to 8 lines");
  if (words(spoken) > SHORT_MAX_WORDS) problems.push("short: too long to say in 45 seconds");
  if (breaksPersona(spoken)) problems.push("short: talks about engineering work");
  if (sameHook(short.hook, winner.title)) problems.push("short: hook repeats the original");
  if (sameHook(remix.retest.hook, short.hook)) problems.push("retest: hook repeats the new hook");
  for (const [name, text] of [["tweet", remix.tweet], ["threads", remix.threads], ["short", spoken]] as const) {
    if (DASHES.test(text)) problems.push(`${name}: has a dash`);
  }
  return problems;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseRemix(raw: string, now: Date, timeZone: string): Remix {
  const cleaned = raw.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("the writer did not return JSON");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  const rawShort = (parsed.short ?? {}) as Record<string, unknown>;
  const short: ShortScript = {
    hook: text(rawShort.hook),
    lines: strings(rawShort.lines),
    cta: text(rawShort.cta),
    headlines: strings(rawShort.headlines),
    broll: strings(rawShort.broll)
  };
  return {
    angle: text(parsed.angle),
    short,
    threads: text(parsed.threads),
    tweet: text(parsed.tweet),
    retest: retestPlan(now, timeZone, text(parsed.retestHook)),
    flags: strings(parsed.flags)
  };
}
