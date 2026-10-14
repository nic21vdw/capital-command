import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_CHANNELS, DEFAULT_BRAND_KIT } from "@/lib/brand/defaults";

const SRC = path.join(process.cwd(), "src");

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) files.push(full);
  }
  return files;
}

const relative = (file: string) => path.relative(process.cwd(), file).replace(/\\/g, "/");

const isTest = (file: string) => /\.test\.tsx?$/.test(file) || /(^|\/)test-helpers\.ts$/.test(file);

const sources = walk(SRC)
  .map((file) => ({ file: relative(file), text: readFileSync(file, "utf8") }))
  .filter(({ file }) => !file.startsWith("src/lib/brand/") && !isTest(file));

const IDENTITY = /nic\s+vandewetering|nicvandewetering|nic21vdw/i;

const IDENTITY_ALLOWED: Record<string, string> = {};

const BANNED_ENTRIES = [
  ...new Set(
    [
      ...DEFAULT_BRAND_KIT.voice.bannedPhrases,
      ...DEFAULT_BRAND_KIT.voice.claimTriggers,
      ...BRAND_CHANNELS.flatMap((channel) => DEFAULT_BRAND_KIT.channels[channel].avoid)
    ].map((entry) => entry.toLowerCase())
  )
];

const WINDOW = 8;
const THRESHOLD = 4;

const BANNED_LIST_ALLOWED: Record<string, string> = {
  "src/lib/storage/schemas.ts":
    "the default Threads positioning brief describes topics in industry jargon on purpose; the generator prompt tells the model not to lift its wording"
};

function phrasePattern(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu");
}

const BANNED_PATTERNS = BANNED_ENTRIES.map((entry) => ({ entry, pattern: phrasePattern(entry) }));

function bannedListHits(text: string): number[] {
  const lines = text.split("\n");
  const hits: number[] = [];
  for (let start = 0; start < lines.length; start += 1) {
    const window = lines.slice(start, start + WINDOW).join("\n");
    const found = BANNED_PATTERNS.filter(({ pattern }) => pattern.test(window)).length;
    if (found >= THRESHOLD) {
      hits.push(start + 1);
      start += WINDOW - 1;
    }
  }
  return hits;
}

const ANALYSIS_ONLY: Record<string, string> = {
  "src/lib/clipping/virality.ts": "scores candidate clips; the model's reply is a number, never published copy",
  "src/lib/clipping/transcript-select.ts": "picks moments in a transcript; the reply is timestamps and scores",
  "src/lib/youtube/competitor-insights.ts": "analyses other channels for Nic to read; nothing it writes is posted",
  "src/lib/music/brief.ts": "writes a Suno brief; the output is an audio prompt, not brand copy",
  "src/lib/master-calendar/planner.ts": "suggests which idea goes in which gap; schedule entries, not copy",
  "src/lib/voice/textAgent.ts": "its system prompt is built by voiceInstructions, which includes the kit block",
  "src/lib/longform/highlights.ts": "chooses which passages of a stream make the edit; the reply is passage ids, and it reads the kit context directly"
};

const NO_RULES_PASS: Record<string, string> = {
  "src/lib/studio/scripts.ts": "a spoken script is read aloud, so the channel is exempt from rewriting",
  "src/lib/voice/prompt.ts": "instructions for the voice console, not published copy",
  "src/lib/clipping/hashtags.ts": "returns tags that are normalised and capped by the kit's hashtag policy, not prose",
  "src/lib/x-posts/generator.ts": "every post and reply is built through humanize in x-posts/voice.ts, which applies the kit rules"
};

describe("nothing outside src/lib/brand hand-copies the brand", () => {
  it("scans real files", () => {
    expect(sources.length).toBeGreaterThan(200);
  });

  it("names the speaker and their handles only in the kit", () => {
    const offenders = sources
      .filter(({ file, text }) => IDENTITY.test(text) && !(file in IDENTITY_ALLOWED))
      .map(({ file, text }) => `${file}: ${text.split("\n").findIndex((line) => IDENTITY.test(line)) + 1}`);
    expect(offenders).toEqual([]);
  });

  it("keeps banned phrase lists in the kit", () => {
    const offenders = sources
      .filter(({ file }) => !(file in BANNED_LIST_ALLOWED))
      .flatMap(({ file, text }) => bannedListHits(text).map((line) => `${file}:${line}`));
    expect(offenders).toEqual([]);
  });

  it("gives every allow-list entry a reason and a file that still exists", () => {
    for (const table of [IDENTITY_ALLOWED, BANNED_LIST_ALLOWED, ANALYSIS_ONLY, NO_RULES_PASS]) {
      for (const [file, reason] of Object.entries(table)) {
        expect(reason.length, file).toBeGreaterThan(15);
        expect(sources.some((source) => source.file === file), `${file} is gone, drop it from the allow-list`).toBe(true);
      }
    }
  });
});

describe("every AI generator includes the kit", () => {
  const callers = sources.filter(({ file, text }) => /\brunAi\(/.test(text) && !file.startsWith("src/lib/ai/"));

  it("finds the generators", () => {
    expect(callers.length).toBeGreaterThan(15);
  });

  it("asks for brandPromptBlock, unless it only analyses", () => {
    const missing = callers
      .filter(({ file, text }) => !/\bbrandPromptBlock\(/.test(text) && !(file in ANALYSIS_ONLY))
      .map(({ file }) => file);
    expect(missing).toEqual([]);
  });

  it("passes what it writes through applyBrandRules", () => {
    const missing = sources
      .filter(({ file, text }) => /\bbrandPromptBlock\(/.test(text) && !/\bapplyBrandRules\(/.test(text) && !(file in NO_RULES_PASS))
      .map(({ file }) => file);
    expect(missing).toEqual([]);
  });
});
