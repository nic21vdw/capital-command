import { z } from "zod";

export const BRAND_CHANNELS = [
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "linkedin",
  "threads",
  "x",
  "youtube-longform",
  "carousel",
  "launch",
  "outreach",
  "script",
  "voice"
] as const;

export type BrandChannel = (typeof BRAND_CHANNELS)[number];

export function isBrandChannel(value: unknown): value is BrandChannel {
  return typeof value === "string" && (BRAND_CHANNELS as readonly string[]).includes(value);
}

const line = z.string().trim().min(1).max(2000);
const lines = z.array(line).max(200);

const channelSchema = z.object({
  label: z.string().trim().min(1).max(80),
  family: z.enum(["short-form", "long-form", "text", "carousel", "launch", "outreach", "script", "voice"]),
  guide: z.string().trim().max(2000),
  plainTalk: z.boolean(),
  useKeywords: z.boolean(),
  emoji: z.enum(["none", "sparing", "allowed"]),
  hashtags: z.object({
    target: z.number().int().min(0).max(30),
    max: z.number().int().min(0).max(30),
    base: z.array(z.string().trim().min(1).max(60)).max(10)
  }),
  cta: z.object({
    line: z.string().trim().max(200),
    url: z.string().trim().max(500)
  }),
  avoid: lines,
  rules: lines
});

export type BrandChannelConfig = z.infer<typeof channelSchema>;

const channelShape = Object.fromEntries(BRAND_CHANNELS.map((channel) => [channel, channelSchema])) as Record<
  BrandChannel,
  typeof channelSchema
>;

export const brandKitSchema = z.object({
  identity: z.object({
    name: z.string().trim().min(1).max(120),
    firstName: z.string().trim().min(1).max(60),
    handle: z.string().trim().max(60),
    role: z.string().trim().max(200)
  }),
  links: z.object({
    site: z.string().trim().min(1).max(300),
    youtube: z.string().trim().max(300),
    x: z.string().trim().max(300)
  }),
  products: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(60),
        name: z.string().trim().min(1).max(80),
        oneLiner: z.string().trim().min(1).max(600)
      })
    )
    .min(1)
    .max(20),
  positioning: z.object({
    oneLiner: z.string().trim().min(1).max(600),
    description: z.string().trim().min(1).max(600),
    buildStory: z.string().trim().max(600),
    audience: z.string().trim().max(300),
    tagline: z.string().trim().max(300),
    eyebrow: z.string().trim().max(120),
    trustline: z.string().trim().max(200),
    pillars: z
      .array(z.object({ name: z.string().trim().min(1).max(80), claim: z.string().trim().min(1).max(300) }))
      .max(12)
  }),
  vocabulary: z.object({
    use: z.array(z.string().trim().min(1).max(120)).max(60),
    keywords: z.array(z.string().trim().min(1).max(60)).max(60),
    fallbackHashtags: z.array(z.string().trim().min(1).max(60)).max(20),
    properNames: z.array(z.string().trim().min(1).max(60)).max(60),
    titleExamples: z.array(z.string().trim().min(1).max(160)).max(30)
  }),
  voice: z.object({
    rules: lines,
    dashes: z.enum(["strip", "allow"]),
    dashRule: z.string().trim().max(400),
    bannedPhrases: z.array(z.string().trim().min(1).max(120)).max(200),
    bannedClaims: lines,
    claimTriggers: z.array(z.string().trim().min(1).max(120)).max(100),
    retiredNames: z
      .array(z.object({ name: z.string().trim().min(1).max(120), use: z.string().trim().min(1).max(120) }))
      .max(20),
    substitutions: z
      .array(z.object({ from: z.string().trim().min(1).max(60), to: z.string().trim().min(1).max(60) }))
      .max(100)
  }),
  channels: z.object(channelShape),
  palette: z.object({
    stage: z.string().trim().min(1).max(20),
    purple: z.string().trim().min(1).max(20),
    indigo: z.string().trim().min(1).max(20),
    ink: z.string().trim().min(1).max(20),
    tagline: z.string().trim().min(1).max(20),
    beamyBody: z.string().trim().min(1).max(20),
    beamyHat: z.string().trim().min(1).max(20)
  }),
  type: z.object({
    family: z.string().trim().min(1).max(60),
    wordmarkWeight: z.number().int().min(100).max(950),
    wordmarkTracking: z.string().trim().min(1).max(20)
  }),
  logo: z.object({
    path: z.string().trim().min(1).max(300),
    wordmark: z.string().trim().min(1).max(60)
  }),
  carousel: z.object({
    signature: z.object({
      name: z.string().trim().max(120),
      handle: z.string().trim().max(60)
    })
  })
});

export type BrandKit = z.infer<typeof brandKitSchema>;

export type BrandKitOverrides = Record<string, unknown>;

const NAME = "Nic Vandewetering";
const SITE = "https://colateralai.com";

const DESCRIPTION =
  "CoLateral is a desktop agentic workspace for developers, creators and engineers, where AI agents, files and ideas share one project canvas.";

const BUILD_STORY =
  "He builds it live with Claude Code, Codex and other AI tools, sharing the real product work, experiments, mistakes and business decisions along the way.";

const HYPE = ["revolutionary", "game-changing", "game changing", "seamlessly", "empower", "unlock"];

const TRADE_WORDS = [
  "agentic",
  "workflow",
  "throughput",
  "verification loop",
  "vertical AI",
  "leverage",
  "iterate",
  "ship velocity",
  "bottleneck",
  "stack",
  "pipeline",
  "context window",
  "tooling",
  "orchestration"
];

const MODEL_TELLS = [
  "delve",
  "robust",
  "seamless",
  "landscape",
  "testament",
  "crucial",
  "here's the thing",
  "the truth is",
  "most people think",
  "Thoughts?",
  "Agree?",
  "who else"
];

const TEXT_POST_RULES = [
  "Write the way {firstName} talks: short, plain, specific, a bit blunt. No jargon, no thought-leader voice, no essays.",
  "A post is one useful thought, one or two lines, and it leaves room for a real conversation.",
  "Write like a person typing on a phone, not like polished marketing copy: plain words, varied sentence length and contractions.",
  "Someone outside engineering has to get it instantly. Say it the way you would say it out loud to a friend, not the way it would be written down.",
  "No \"it's not X, it's Y\" seesaws. No rule-of-three lists where every item is the same length.",
  "No wise closing line that restates the post as a law. Real posts just stop.",
  "Plain words over impressive ones: \"use\" not \"leverage\", \"start\" not \"embark\", \"so\" not \"thus\".",
  "Use contractions throughout. Start a sentence with And or But when it reads better. Trailing thoughts are fine.",
  "Say the specific thing using supported details. Without a supplied real event, use a concrete example someone can try, not a made-up number, hour or thing that broke."
];

const NO_HASHTAGS = { target: 0, max: 0, base: [] as string[] };

const textChannel = (label: string, guide: string, url: string) => ({
  label,
  family: "text" as const,
  guide,
  plainTalk: true,
  useKeywords: false,
  emoji: "none" as const,
  hashtags: NO_HASHTAGS,
  cta: { line: "Explore CoLateral", url },
  avoid: [...TRADE_WORDS, ...MODEL_TELLS],
  rules: TEXT_POST_RULES
});

export const DEFAULT_BRAND_KIT: BrandKit = brandKitSchema.parse({
  identity: {
    name: NAME,
    firstName: "Nic",
    handle: "@nicvandewetering",
    role: "Founder and builder of CoLateral"
  },
  links: {
    site: SITE,
    youtube: "https://www.youtube.com/@nicvandewetering",
    x: "https://x.com/nic21vdw"
  },
  products: [
    {
      id: "colateral",
      name: "CoLateral",
      oneLiner:
        "The all-in-one agentic workspace: one desktop canvas where your Claude Code, Codex and Gemini agents work side by side, inside your real files."
    },
    {
      id: "colateral-marketing",
      name: "CoLateral Marketing",
      oneLiner: "The social-media pack."
    }
  ],
  positioning: {
    oneLiner:
      "CoLateral is the all-in-one agentic workspace: one desktop canvas where your Claude Code, Codex and Gemini agents work side by side, inside your real files.",
    description: DESCRIPTION,
    buildStory: BUILD_STORY,
    audience: "Developers first, creators second. Engineers are welcome as users of the general workspace, the same as anyone else.",
    tagline: "The canvas where you lay out your work and agents work beside you.",
    eyebrow: "The all-in-one agentic workspace",
    trustline: "For developers, creators and engineers alike",
    pillars: [
      { name: "All-in-one canvas", claim: "Agents, files and notes in one place" },
      { name: "Agents side by side", claim: "Claude Code, Codex and Gemini at once" },
      { name: "Your real files", claim: "Agents edit the actual slides, sheets and documents" },
      { name: "Bring your own AI, pay once", claim: "No AI fee, one-time licence" }
    ]
  },
  vocabulary: {
    use: [
      "agentic workspace",
      "canvas",
      "agent cards",
      "side by side",
      "your real files",
      "slides, sheets and documents",
      "bring your own AI subscriptions",
      "no AI fee",
      "pay once",
      "one-time licence"
    ],
    keywords: [
      "AI",
      "vibe coding",
      "Claude",
      "Codex",
      "ChatGPT",
      "AI agents",
      "agentic workspace",
      "project canvas",
      "coding",
      "SaaS",
      "startup",
      "business",
      "building in public",
      "engineering",
      "automation"
    ],
    fallbackHashtags: ["AI", "vibecoding", "coding", "buildinpublic", "startup"],
    properNames: ["Claude", "Claude Code", "Opus", "Codex", "Warp", "Cursor", "Grok", "CoLateral", "Streamer.bot", "Remotion", "Vandewetering"],
    titleExamples: [
      "Vibe Coding a SaaS With Claude in 30 Minutes",
      "This AI Coding Trick Saves Me Hours Every Week",
      "Why I Let AI Write All My Code",
      "ChatGPT vs Claude for Real Business Work",
      "Building a Startup Live With AI Agents",
      "The AI Mistake Every New Founder Makes",
      "I Made AI Build My Entire Landing Page",
      "I Put My AI Agents and Files on One Canvas"
    ]
  },
  voice: {
    rules: [
      "Write like the founder talking, not like a press release or a brand.",
      "Be concrete about what the product actually does, so a reader who has never heard of it understands it.",
      "Never invent facts, numbers, users, prices, launch dates, sales, time savings, personal anecdotes or results. A goal is not a shipped feature: write \"I want\" or \"I'm building toward\", never \"you can now\" or \"it does\".",
      "Complete, grammatical sentences. Never a raw transcript fragment and never a thought that trails off.",
      "Nothing may promise something the app does not do.",
      "{firstName}'s own story is fine: an engineer by day job who builds software and builds CoLateral in public. That is his background, not a product claim."
    ],
    dashes: "strip",
    dashRule: "Never an em dash or an en dash. Not one, anywhere. Use a comma, a full stop, or a new line. It is the single clearest tell.",
    bannedPhrases: [...HYPE, "Excited to share", "Just wrapped up"],
    bannedClaims: [
      "Never say \"CoLateral Engineering\" or anything that markets the structural pack.",
      "Never present CoLateral as engineering, structural or design software: no design checkers, load paths, calculations, beams, tool counts or \"for qualified structural engineers\".",
      "Never make a licence, stamp, approval or compliance claim (\"certified\", \"stamped\", \"code-approved\", \"guarantees compliance\")."
    ],
    claimTriggers: [
      "CoLateral Engineering",
      "certified",
      "stamped",
      "code-approved",
      "guarantees compliance",
      "qualified structural engineers"
    ],
    retiredNames: [{ name: "Capital Command", use: "CoLateral Marketing" }],
    substitutions: [
      { from: "utilize", to: "use" },
      { from: "utilise", to: "use" }
    ]
  },
  channels: {
    linkedin: {
      label: "LinkedIn",
      family: "text",
      guide: "LinkedIn: professional and first-person. Open with one concrete line, then 2-4 short paragraphs about supported product work and why it matters. No slang or engagement bait. End with a plain invitation to read or watch.",
      plainTalk: false,
      useKeywords: true,
      emoji: "none",
      hashtags: { target: 3, max: 3, base: [] },
      cta: { line: "Try CoLateral", url: `${SITE}/li` },
      avoid: [],
      rules: ["No invented results or product claims."]
    },
    youtube: {
      label: "YouTube Shorts",
      family: "short-form",
      guide:
        "YouTube Shorts: a searchable, benefit-led caption (viewers find Shorts via search and suggested). Front-load keywords, 1-2 sentences, then hashtags. Favor discoverability over slang.",
      plainTalk: false,
      useKeywords: true,
      emoji: "none",
      hashtags: { target: 4, max: 6, base: ["#shorts"] },
      cta: { line: "Try CoLateral", url: `${SITE}/yt` },
      avoid: [],
      rules: ["No clickbait lies."]
    },
    tiktok: {
      label: "TikTok",
      family: "short-form",
      guide:
        "TikTok: native, punchy, conversational hook in the first line. Write like a creator, not a brand. Short. Mix a couple of broad trend hashtags with niche ones.",
      plainTalk: false,
      useKeywords: true,
      emoji: "sparing",
      hashtags: { target: 5, max: 8, base: [] },
      cta: { line: "Try CoLateral", url: `${SITE}/tt` },
      avoid: [],
      rules: ["No clickbait lies, no emoji spam."]
    },
    instagram: {
      label: "Instagram Reels",
      family: "short-form",
      guide:
        "Instagram Reels: a caption with personality and a light call-to-engage (save/share). A tasteful line break is fine. Hashtags are expected and should blend broad + niche.",
      plainTalk: false,
      useKeywords: true,
      emoji: "sparing",
      hashtags: { target: 8, max: 8, base: [] },
      cta: { line: "Try CoLateral", url: `${SITE}/ig` },
      avoid: [],
      rules: ["No clickbait lies, no emoji spam."]
    },
    facebook: {
      label: "Facebook Reels",
      family: "short-form",
      guide: "Facebook Reels: slightly longer, plain-spoken and context-giving for an older audience. Fewer hashtags; clarity over slang.",
      plainTalk: false,
      useKeywords: true,
      emoji: "sparing",
      hashtags: { target: 3, max: 8, base: [] },
      cta: { line: "Try CoLateral", url: `${SITE}/fb` },
      avoid: [],
      rules: ["No clickbait lies, no emoji spam."]
    },
    threads: textChannel(
      "Threads",
      "Threads: personal-feed posts, one useful thought each. Parent posts carry no link, bait or hashtag; a separate self-reply supplies the invitation.",
      `${SITE}/th`
    ),
    x: textChannel("X", "X: personal-feed posts under 270 characters, one useful thought each, no link or bait in the post itself.", `${SITE}/x`),
    "youtube-longform": {
      label: "YouTube long-form",
      family: "long-form",
      guide:
        "YouTube long-form: titles are complete grammatical phrases in Title Case that lead with curiosity, stakes or a bold claim. Descriptions open with a hook, say what the video covers, and close with a subscribe line.",
      plainTalk: false,
      useKeywords: true,
      emoji: "none",
      hashtags: { target: 4, max: 5, base: [] },
      cta: { line: "Explore CoLateral", url: SITE },
      avoid: [],
      rules: [
        "When CoLateral is relevant, use the channel description above. Never narrow it to one profession or engineering discipline.",
        "No invented facts, links, or timestamps you were not given."
      ]
    },
    carousel: {
      label: "Carousel",
      family: "carousel",
      guide:
        "Carousel: the same deck is posted across Instagram, Facebook and TikTok, so keep the copy platform-neutral. No \"Instagram\" or \"IG\"-only references, and nothing that only makes sense on one network.",
      plainTalk: false,
      useKeywords: true,
      emoji: "sparing",
      hashtags: NO_HASHTAGS,
      cta: { line: "Try it at colateralai.com", url: SITE },
      avoid: [
        "building in public",
        "one vibe at a time",
        "big things coming",
        "this is only the beginning",
        "the grind",
        "follow the journey",
        "let's go",
        "game changer",
        "buckle up"
      ],
      rules: [
        "Write in {firstName}'s own voice, first person: \"I\", \"my\", \"we\" for him and chat together. Never \"he\", \"{firstName}\" or \"the creator\", because the slides are posted from his account.",
        "Plain, confident, human language: short words, active verbs, the way a sharp friend would retell the night.",
        "Emojis are optional seasoning: at most one per slide, only where it adds meaning (🚀 ship, 🐛 bug, 💸 money, 🤖 AI agent, ⚠️ problem, ✅ fixed), and never in place of a word. Most slides read better with none."
      ]
    },
    launch: {
      label: "Product Hunt launch",
      family: "launch",
      guide:
        "Product Hunt launch copy: write like the founder, not like a press release. Be concrete about what the product actually does; a reader who has never heard of it should understand it from the tagline alone.",
      plainTalk: false,
      useKeywords: true,
      emoji: "none",
      hashtags: NO_HASHTAGS,
      cta: { line: "", url: SITE },
      avoid: [],
      rules: [
        "Use the channel keywords in the social posts only.",
        "Never ask anyone to upvote. Product Hunt penalises it.",
        "No emoji in the tagline or description. At most one in a social post, and only if it earns its place."
      ]
    },
    outreach: {
      label: "Outreach",
      family: "outreach",
      guide: "Outreach: a short personal note to a creator, newsletter or podcast. Never a pitch deck, never pushy.",
      plainTalk: true,
      useKeywords: false,
      emoji: "none",
      hashtags: NO_HASHTAGS,
      cta: { line: "", url: SITE },
      avoid: [],
      rules: []
    },
    script: {
      label: "Video script",
      family: "script",
      guide: "Video script: spoken words for a YouTube video about building software with AI.",
      plainTalk: false,
      useKeywords: true,
      emoji: "none",
      hashtags: NO_HASHTAGS,
      cta: { line: "Explore CoLateral", url: SITE },
      avoid: [],
      rules: []
    },
    voice: {
      label: "Voice console",
      family: "voice",
      guide: "Voice console: spoken answers to the person running the system, short and conversational.",
      plainTalk: true,
      useKeywords: false,
      emoji: "none",
      hashtags: NO_HASHTAGS,
      cta: { line: "", url: "" },
      avoid: [],
      rules: []
    }
  },
  palette: {
    stage: "#070c12",
    purple: "#bd93f9",
    indigo: "#b580ff",
    ink: "#f7fbff",
    tagline: "#c6d7e7",
    beamyBody: "#8a5cc9",
    beamyHat: "#ece6d8"
  },
  type: {
    family: "Inter",
    wordmarkWeight: 850,
    wordmarkTracking: "-0.055em"
  },
  logo: {
    path: "/icons/icon-512.png",
    wordmark: "CoLateral"
  },
  carousel: {
    signature: { name: NAME, handle: "" }
  }
});

export function channelContext(kit: BrandKit): string {
  return `The creator is ${kit.identity.name}, ${kit.identity.role.charAt(0).toLowerCase()}${kit.identity.role.slice(1)}. ${kit.positioning.description} ${kit.positioning.buildStory}`.trim();
}
