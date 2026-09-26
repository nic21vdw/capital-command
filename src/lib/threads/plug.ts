import type { ThreadsConfig } from "@/lib/threads/config";

const PLUG_LINES = [
  "see what I'm building here",
  "this is the thing I'm building, if you want a look",
  "what I'm building",
  "if you're curious, it's here",
  "the thing I keep talking about"
];

const MENTIONS_COLATERAL = /\bco-?lateral\b/i;

function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function mentionsColateral(text: string): boolean {
  return MENTIONS_COLATERAL.test(text);
}

export function plugReplyFor(text: string, seed: string, config: ThreadsConfig): string | undefined {
  if (!config.plugReplies || !config.plugUrl || !mentionsColateral(text)) return undefined;
  return `${PLUG_LINES[hash32(seed) % PLUG_LINES.length]}: ${config.plugUrl}`;
}
