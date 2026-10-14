import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BRAND_KIT, channelContext, type BrandChannel } from "@/lib/brand/defaults";
import { brandPromptBlock, saveBrandKitOverrides, type PromptBlockOptions } from "@/lib/brand/kit";
import { PROMPT_CASES, type CapturedPrompt } from "@/lib/brand/prompt-cases";
import { takeCaptured } from "@/lib/brand/prompt-capture";

vi.mock("@/lib/ai", async () => {
  const { captureRequest } = await import("@/lib/brand/prompt-capture");
  return { aiConfigured: () => true, runAi: async (request: Parameters<typeof captureRequest>[0]) => (captureRequest(request), null) };
});

vi.mock("@/lib/ai/provider", async () => {
  const { captureRequest } = await import("@/lib/brand/prompt-capture");
  return { aiConfigured: () => true, runAi: async (request: Parameters<typeof captureRequest>[0]) => (captureRequest(request), null) };
});

vi.mock("@/lib/agents/context", () => ({ sourceflowContext: async () => "SNAPSHOT" }));

const BEFORE: Record<string, CapturedPrompt[]> = JSON.parse(readFileSync(path.join(__dirname, "prompt-parity.before.json"), "utf8"));

const CONTEXT = channelContext(DEFAULT_BRAND_KIT);
const KEYWORDS = DEFAULT_BRAND_KIT.vocabulary.keywords.join(", ");

type BlockUse = { channel: BrandChannel; options?: PromptBlockOptions };

const BLOCKS: Record<string, BlockUse[] | null> = {
  "launch-copy": [{ channel: "launch" }],
  "x-posts-daily-pack": [{ channel: "threads" }],
  "publisher-platform-copy": [{ channel: "youtube" }, { channel: "tiktok" }, { channel: "instagram" }, { channel: "facebook" }],
  "publisher-clip-title": [{ channel: "youtube" }],
  "clip-viral-titles": [{ channel: "youtube" }],
  "clip-hashtags": [{ channel: "youtube" }],
  "longform-metadata": [{ channel: "youtube-longform" }],
  "longform-topics": [{ channel: "youtube-longform" }],
  "longform-thumbnail-hooks": [{ channel: "youtube-longform" }],
  "pipeline-posts": [{ channel: "threads", options: { keywords: true } }],
  "studio-carousel": [{ channel: "carousel" }, { channel: "carousel" }, { channel: "carousel" }],
  "studio-ideas": [{ channel: "youtube-longform" }],
  "studio-script": [{ channel: "script" }],
  "story-copy": [{ channel: "youtube-longform" }],
  "story-plan": null,
  "voice-console-armed": [{ channel: "voice" }],
  "voice-console-readonly": [{ channel: "voice" }],
  "voice-realtime-session": [{ channel: "voice" }, { channel: "voice" }],
  "outreach-template": null
};

const HYPE_RULES = [
  `Channel context: ${CONTEXT} Recurring keywords for the social posts only, used when they genuinely fit: ${KEYWORDS}.`,
  "House rules for every piece of copy:",
  '- Write like the founder, not like a press release. No "revolutionary", "game-changing", "seamlessly", "empower", or "unlock".',
  "- Be concrete about what the product actually does. A reader who has never heard of it should understand it from the tagline alone.",
  "- Never ask anyone to upvote — Product Hunt penalises it.",
  "- No emoji in the tagline or description. At most one in a social post, and only if it earns its place."
];

const PLATFORM_FRAGMENTS = [
  "YouTube Shorts: a searchable, benefit-led caption (viewers find Shorts via search and suggested). Front-load keywords, 1-2 sentences, then hashtags. Favor discoverability over slang.",
  "TikTok: native, punchy, conversational hook in the first line — write like a creator, not a brand. Short. Mix a couple of broad trend hashtags with niche ones.",
  "Instagram Reels: a caption with personality and a light call-to-engage (save/share). A tasteful line break is fine. Hashtags are expected and should blend broad + niche.",
  "Facebook Reels: slightly longer, plain-spoken and context-giving for an older audience. Fewer hashtags; clarity over slang."
];

const CAROUSEL_RULES = [
  `The creator is Nic Vandewetering, founder and builder of CoLateral. ${DEFAULT_BRAND_KIT.positioning.description} ${DEFAULT_BRAND_KIT.positioning.buildStory}`,
  'The same carousel is posted across Instagram, Facebook, and TikTok, so keep the copy platform-neutral - no "Instagram" / "IG"-only references, and nothing that only makes sense on one network.',
  `Channel keywords: ${KEYWORDS}.`,
  '- Never use these phrases or their variants: "building in public", "one vibe at a time", "big things coming", "this is only the beginning", "the grind", "follow the journey", "let\'s go", "game changer", "buckle up".',
  '- Write in Nic\'s own voice, first person: "I", "my", "we" for him and chat together. Never "he", "Nic" or "the creator" — the slides are posted from his account.',
  "- Plain, confident, human language — short words, active verbs, the way a sharp friend would retell the night. No hashtags on slides, no invented facts or numbers.",
  "- Emojis are optional seasoning: at most one per slide, only where it adds meaning (🚀 ship, 🐛 bug, 💸 money, 🤖 AI agent, ⚠️ problem, ✅ fixed), and never in place of a word. Most slides read better with none."
];

const LEGACY: Record<string, string[][]> = {
  "launch-copy": [HYPE_RULES],
  "x-posts-daily-pack": [
    [
      `The creator is Nic Vandewetering, founder and builder of CoLateral. ${DEFAULT_BRAND_KIT.positioning.description} ${DEFAULT_BRAND_KIT.positioning.buildStory}`,
      "You write the way Nic talks: short, plain, specific, a bit blunt. No jargon, no thought-leader voice, no essays.",
      "A post is one useful thought, one or two lines, and it leaves room for a real conversation.",
      "You write like a person typing on their phone, not like polished marketing copy: plain words, varied sentence length and contractions.",
      "Never use an em dash or en dash.",
      "Never fabricate facts, projects, experiences or numbers. A goal is not a shipped feature.",
      "The current names are CoLateral and CoLateral Marketing. Never call it Capital Command. Nic's day job as an engineer is fine to mention as his own story, but never present CoLateral as engineering, structural or design software, never mention CoLateral Engineering, and never claim a professional engineering licence, a stamp, approval or compliance.",
      "Someone outside engineering has to get it instantly. Say it the way he would say it out loud to a friend, not the way it would be written down.",
      "Ban the trade words: agentic, workflow, throughput, verification loop, vertical AI, leverage, iterate, ship velocity, bottleneck, stack, pipeline, context window, tooling, orchestration.",
      'Never beg for it either: no "Thoughts?", no "Agree?", no "who else".',
      "- NEVER an em dash or an en dash. Not one, anywhere. Use a comma, a full stop, or a new line. It is the single clearest tell.",
      `- No "it's not X, it's Y" seesaws. No "here's the thing", no "the truth is", no "most people think". No rule-of-three lists where every item is the same length.`,
      "- No wise closing line that restates the post as a law. Real posts just stop.",
      '- Plain words over impressive ones. "use" not "leverage", "start" not "embark", "so" not "thus". No "delve", "robust", "seamless", "landscape", "testament", "crucial".',
      "- Contractions throughout. Start a sentence with And or But when it reads better. Trailing thoughts are fine.",
      "- Say the specific thing using supported details. Without a supplied real event, use a concrete example someone can try, not a made-up number, hour or thing that broke.",
      "- No hashtags, no emoji."
    ]
  ],
  "publisher-platform-copy": PLATFORM_FRAGMENTS.map((guide) => [
    guide,
    `Channel context: ${CONTEXT}`,
    `Channel keywords to weave in when they genuinely fit: ${KEYWORDS}.`
  ]),
  "clip-viral-titles": [
    [
      `Channel context: ${CONTEXT} Recurring keywords to work in whenever the clip's content genuinely supports them: ${KEYWORDS}.`,
      "- Be a complete, grammatical phrase — NEVER a raw transcript fragment and never a thought that trails off mid-sentence."
    ]
  ],
  "clip-hashtags": [[`Channel context: ${CONTEXT} Recurring channel topics: ${KEYWORDS}.`]],
  "longform-metadata": [
    [
      `Channel context: ${CONTEXT} Recurring keywords to work in whenever the video genuinely supports them: ${KEYWORDS}.`,
      "- Be a complete, grammatical phrase — NEVER a transcript fragment.",
      "- When CoLateral is relevant, use the channel description above. Never narrow it to one profession or engineering discipline.",
      "- No invented facts, links, or timestamps you were not given."
    ]
  ],
  "longform-topics": [[`Channel context: ${CONTEXT} Recurring keywords to work in whenever a segment genuinely supports them: ${KEYWORDS}.`]],
  "pipeline-posts": [
    [
      `${CONTEXT} Recurring channel keywords to work in when the content genuinely supports them: ${KEYWORDS}.`,
      "- Complete, grammatical sentences — NEVER a raw transcript fragment and never a thought that trails off.",
      '- No hashtags, no emoji, no generic openers ("Just wrapped up...", "Excited to share...").'
    ]
  ],
  "studio-carousel": [CAROUSEL_RULES, CAROUSEL_RULES, CAROUSEL_RULES],
  "studio-ideas": [[`Channel context: ${CONTEXT} Channel keywords: ${KEYWORDS}.`]],
  "studio-script": [[`Channel context: ${CONTEXT} Channel keywords to weave in naturally: ${KEYWORDS}.`]],
  "story-copy": [[`Channel keywords: ${KEYWORDS}`]]
};

const COVERED: Record<string, string[]> = {
  "launch-copy": ["revolutionary", "game-changing", "seamlessly", "empower", "unlock", "Never ask anyone to upvote", "No emoji in the tagline", "Write like the founder"],
  "x-posts-daily-pack": [
    "Capital Command",
    "CoLateral Engineering",
    "Never an em dash or an en dash",
    "verification loop",
    "orchestration",
    "Thoughts?",
    "who else",
    "delve",
    "crucial",
    "Write the way Nic talks",
    "Use contractions throughout",
    "Hashtags: none.",
    "Emoji: none.",
    "engineer by day job"
  ],
  "publisher-platform-copy": ["Favor discoverability over slang", "broad trend hashtags", "call-to-engage", "Fewer hashtags"],
  "clip-viral-titles": ["Never a raw transcript fragment"],
  "clip-hashtags": ["Channel keywords"],
  "longform-metadata": ["Never narrow it to one profession or engineering discipline", "No invented facts, links, or timestamps you were not given"],
  "pipeline-posts": ["Excited to share", "Just wrapped up", "Hashtags: none.", "Never a raw transcript fragment"],
  "studio-carousel": [
    "platform-neutral",
    "one vibe at a time",
    "buckle up",
    "Never \"he\", \"Nic\" or \"the creator\"",
    "short words, active verbs",
    "at most one per slide"
  ]
};

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

function joined(entry: CapturedPrompt): string {
  return `${entry.system}\n@@USER@@\n${entry.user}`;
}

function withoutBlock(entry: CapturedPrompt, block: string): { text: string; found: number } {
  const text = joined(entry);
  return { text: text.split(block).join(""), found: text.split(block).length - 1 };
}

describe("every generator reads the brand kit, and nothing else about its prompt changed", () => {
  for (const entry of PROMPT_CASES) {
    it(`${entry.id}: differs from the recorded prompt only by the kit block`, async () => {
      takeCaptured();
      await entry.run();
      const after = takeCaptured();
      const before = BEFORE[entry.id];
      const uses = BLOCKS[entry.id];
      const legacy = LEGACY[entry.id] ?? [];
      expect(after).toHaveLength(before.length);

      after.forEach((prompt, index) => {
        let expected = squash(joined(before[index]));
        for (const fragment of legacy[index] ?? legacy[0] ?? []) {
          const needle = squash(fragment);
          expect(expected, `legacy text not in the recorded prompt: ${needle.slice(0, 60)}`).toContain(needle);
          expected = squash(expected.replace(needle, ""));
        }
        let actual = joined(prompt);
        if (uses) {
          const use = uses[index] ?? uses[0];
          const block = brandPromptBlock(use.channel, use.options);
          const { text, found } = withoutBlock(prompt, block);
          expect(found, "the kit block must appear exactly once").toBe(1);
          actual = text;
        } else {
          expect(joined(prompt)).not.toContain("Brand kit for this piece");
        }
        expect(squash(actual)).toBe(expected);
      });
    });
  }

  for (const [id, phrases] of Object.entries(COVERED)) {
    it(`${id}: the kit block carries the rules that were hand-copied into the prompt`, () => {
      const blocks = (BLOCKS[id] ?? []).map((use) => brandPromptBlock(use.channel, use.options).toLowerCase());
      for (const phrase of phrases) {
        expect(blocks.some((block) => block.includes(phrase.toLowerCase())), phrase).toBe(true);
      }
    });
  }
});

describe("a changed kit reaches every generator", () => {
  let dir: string;
  const previous = process.env.CAPITAL_COMMAND_DATA_DIR;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "brand-parity-"));
    process.env.CAPITAL_COMMAND_DATA_DIR = dir;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.CAPITAL_COMMAND_DATA_DIR;
    else process.env.CAPITAL_COMMAND_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  for (const entry of PROMPT_CASES.filter((candidate) => BLOCKS[candidate.id] !== null || candidate.id === "story-plan")) {
    it(`${entry.id}: names the overridden speaker and not the default one`, async () => {
      await saveBrandKitOverrides({
        identity: { name: "Ada Lovelace", firstName: "Ada", handle: "@ada" },
        voice: { bannedPhrases: ["synergy"] }
      });
      takeCaptured();
      await entry.run();
      const prompts = takeCaptured();
      expect(prompts.length).toBeGreaterThan(0);
      for (const prompt of prompts) {
        const text = joined(prompt);
        expect(text).not.toContain("Nic Vandewetering");
        expect(text).not.toMatch(/\bNic\b/);
        expect(text).not.toContain("@nicvandewetering");
        if (BLOCKS[entry.id]) {
          expect(text).toContain("Ada Lovelace");
          expect(text).toContain("synergy");
          expect(text).not.toContain("revolutionary");
        }
      }
    });
  }
});
