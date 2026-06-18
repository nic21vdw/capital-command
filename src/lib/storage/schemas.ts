import { z } from "zod";

export const holdingSchema = z.object({
  id: z.string(),
  ticker: z.string().trim().min(1),
  name: z.string().trim().min(1),
  assetClass: z.enum(["Stocks", "ETFs", "Crypto", "Cash", "Bonds", "Funds", "REITs", "Other"]),
  account: z.string().trim().min(1),
  quantity: z.coerce.number().min(0),
  averageCost: z.coerce.number().min(0),
  currentPrice: z.coerce.number().min(0).optional(),
  manualPrice: z.coerce.number().min(0).optional(),
  dividendYield: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().optional(),
  updatedAt: z.string()
});

export const watchlistSchema = z.object({
  id: z.string(),
  ticker: z.string().trim().min(1),
  name: z.string().trim().min(1),
  assetClass: z.enum(["Stocks", "ETFs", "Crypto", "Cash", "Bonds", "Funds", "REITs", "Other"]),
  currentPrice: z.coerce.number().min(0).optional(),
  targetBuyPrice: z.coerce.number().min(0).optional(),
  reason: z.string().trim().min(1),
  riskRating: z.coerce.number().int().min(1).max(5),
  convictionRating: z.coerce.number().int().min(1).max(5),
  notes: z.string().optional(),
  dateAdded: z.string()
});

export const researchNoteSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1),
  relatedTicker: z.string().optional(),
  thesis: z.string().trim().min(1),
  bullCase: z.string().trim().min(1),
  bearCase: z.string().trim().min(1),
  keyRisks: z.string().trim().min(1),
  valuationThoughts: z.string().trim().min(1),
  sourceLinks: z.array(z.string()),
  tags: z.array(z.string()),
  body: z.string().trim().min(1),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const goalSchema = z.object({
  id: z.string(),
  goalName: z.string().trim().min(1),
  targetAmount: z.coerce.number().min(0),
  currentAmount: z.coerce.number().min(0),
  targetDate: z.string().optional(),
  monthlyContribution: z.coerce.number().min(0).optional(),
  notes: z.string().optional()
});

export const expenseSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1),
  vendor: z.string().optional(),
  category: z.enum(["Hardware", "AI Subscription", "Cloud", "Software", "Peripherals", "Other"]),
  frequency: z.enum(["one-time", "monthly", "yearly"]),
  amount: z.coerce.number().min(0),
  currency: z.enum(["CAD", "USD"]),
  date: z.string(),
  active: z.coerce.boolean(),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const userProfileSchema = z.object({
  displayName: z.string().trim().max(60).optional(),
  // Avatar is stored inline as a data URL; cap the size to keep payloads sane.
  avatar: z.string().max(2_000_000).optional()
});

export const settingsSchema = z.object({
  currency: z.enum(["CAD", "USD"]),
  // Unknown/legacy values (e.g. old accent ids) gracefully fall back to undefined,
  // and the UI resolves that to the default preset at runtime.
  themePreset: z.enum(["slate", "midnight", "graphite", "forest", "paper", "arctic"]).optional().catch(undefined),
  profile: userProfileSchema.optional()
});

export const contentItemSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1),
  type: z.enum(["Video", "Short", "Stream", "Podcast"]),
  platform: z.enum(["YouTube", "Twitch", "TikTok", "Instagram", "Other"]),
  status: z.enum(["Idea", "Scripting", "Recording", "Editing", "Scheduled", "Published"]),
  publishDate: z.string().optional(),
  url: z.string().optional(),
  views: z.coerce.number().min(0).optional(),
  likes: z.coerce.number().min(0).optional(),
  comments: z.coerce.number().min(0).optional(),
  watchHours: z.coerce.number().min(0).optional(),
  revenue: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const creatorProfileSchema = z.object({
  channelName: z.string().trim().default(""),
  platform: z.enum(["YouTube", "Twitch", "TikTok", "Instagram", "Other"]).default("YouTube"),
  subscribers: z.coerce.number().min(0).default(0),
  totalViews: z.coerce.number().min(0).default(0),
  watchHours: z.coerce.number().min(0).default(0),
  monetized: z.coerce.boolean().default(false),
  subscriberGoal: z.coerce.number().min(0).default(1000),
  monthlyRevenueGoal: z.coerce.number().min(0).default(0),
  updatedAt: z.string().default(() => new Date().toISOString())
});

export const defaultCreatorProfile = creatorProfileSchema.parse({});

export const executionCategorySchema = z.enum([
  "X / Twitter",
  "Reddit",
  "YouTube",
  "CoLateral",
  "Structural Engineering",
  "Community & Networking"
]);

export const executionGoalSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1),
  description: z.string().optional(),
  category: executionCategorySchema,
  frequency: z.enum(["daily", "weekly"]),
  dailyTarget: z.coerce.number().min(0),
  weeklyTarget: z.coerce.number().min(0),
  icon: z.string().trim().min(1),
  displayOrder: z.coerce.number().int(),
  active: z.coerce.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().optional()
});

export const executionCompletionSchema = z.object({
  id: z.string(),
  goalId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  timestamp: z.string(),
  quantity: z.coerce.number().int().min(1),
  source: z.literal("manual"),
  note: z.string().optional(),
  createdAt: z.string()
});

export const executionPeriodSchema = z.object({
  id: z.string(),
  goalId: z.string(),
  weekStart: z.string(),
  weekEnd: z.string(),
  baseline: z.coerce.number().min(0),
  startingDebt: z.coerce.number().min(0),
  effectiveRequired: z.coerce.number().min(0),
  completed: z.coerce.number().min(0),
  baselineCompleted: z.coerce.number().min(0),
  debtPaid: z.coerce.number().min(0),
  newDebt: z.coerce.number().min(0),
  endingDebt: z.coerce.number().min(0),
  overachievement: z.coerce.number().min(0),
  successful: z.coerce.boolean(),
  finalized: z.coerce.boolean(),
  finalizedAt: z.string().optional()
});

export const executionDebtSchema = z.object({
  id: z.string(),
  goalId: z.string(),
  originWeekStart: z.string(),
  originalQuantity: z.coerce.number().min(0),
  remainingQuantity: z.coerce.number().min(0),
  repaidQuantity: z.coerce.number().min(0),
  createdAt: z.string(),
  fullyRepaidAt: z.string().optional()
});

// Default positioning/voice/strategy used the first time the X tool loads.
// Editable in the tool; persisted in the app data store.
export const DEFAULT_X_BRIEF = `# X Reply Brief

## Positioning
I am Nic Vandewetering (@nic21vdw), a Structural EIT building CoLateral AI: software and AI tools for structural-engineering workflows. My positioning is at the intersection of structural engineering, AI coding agents (Claude Code, Codex), vibe coding, agentic engineering, professional review and verification, and building sophisticated vertical software without a traditional software team.

## Core angles
- Code generation is becoming cheap; judgment, verification, and problem definition become more valuable
- More agents increase review and coordination requirements unless design intent and acceptance criteria are explicit
- In professional engineering, an AI system must preserve assumptions, expose uncertainty, document decisions, and support human review
- The valuable product is the verification and workflow harness around the model, not the model-generated output itself
- AI tools become valuable in vertical industries when they understand the review process, not merely the calculation
- Output volume is a poor metric unless the output can be efficiently validated
- Professional workflows need traceability, controlled assumptions, and clear responsibility boundaries

## Search topics
Claude Code, Codex, agentic engineering, vibe coding, AI coding agents, parallel agents, harness engineering, context engineering, AI code review, evaluation and verification, vertical AI, AI tools for professional or regulated industries, human judgment as the bottleneck, moving from prototypes to reliable production systems

## Accounts to check regularly
@mvanhorn, @petergyang, @sachinrekhi, @martinfowler

## Voice rules
- Write like a sharp engineer who understands business and software
- Confident, specific, natural, respectful, slightly provocative when justified
- Based on consequences not abstract philosophy
- 2-4 sentences maximum
- Do NOT start with: Great post, Exactly, This, Couldn't agree more
- Do NOT use hashtags or emojis
- Do NOT sound like a motivational influencer
- Do NOT mention CoLateral unless directly relevant
- Do NOT turn the reply into a sales pitch
- Do NOT claim to be a licensed professional engineer
- Do NOT invent projects, results, revenue, customers, or statistics
- Do NOT use overly polished AI phrasing or excessive em dashes

## Selection criteria
- Published recently enough to still have an active conversation
- Directly relevant to AI-assisted software development
- Gives me an opportunity to add an engineering or professional-workflow perspective
- Has meaningful engagement but is not so overwhelmed with replies that mine will disappear
- Is not political, inflammatory, spammy, promotional bait, or engagement farming
- Only proceed if the best opportunity scores at least 80/100

## Execution instructions
Search recent posts using the suggested queries. Read the full post, linked material when necessary, and enough of the thread to understand context. Score possible posts on: relevance to positioning, freshness, credibility of the author, ability to add an original insight, probability of creating a real conversation, risk of sounding generic or self-promotional. Draft three possible replies privately. Critique them for generic language, unsupported claims, and AI-sounding phrasing. Choose and refine the strongest reply. Enter it into the X composer. Re-read it alongside the original post. Post it. Report: account replied to, summary of original post, exact reply posted, why this was the strongest opportunity, one possible follow-up response if the author replies.`;

export const xActivitySchema = z.object({
  id: z.string(),
  type: z.enum(["reply", "post"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  account: z.string().trim().optional(),
  topic: z.string().trim().min(1),
  text: z.string().trim().min(1),
  engagement: z.string().trim().optional(),
  createdAt: z.string().default(() => new Date().toISOString())
});

export const xStrategySchema = z.object({
  brief: z.string().default(DEFAULT_X_BRIEF),
  dailyReplyTarget: z.coerce.number().int().min(0).default(3),
  dailyPostTarget: z.coerce.number().int().min(0).default(1),
  activities: z.array(xActivitySchema).default([])
});

export const defaultXStrategy = xStrategySchema.parse({});

// ----- Saved thumbnails (Thumbnail Generator) -----
// A persisted thumbnail project: all of the generator's settings plus the
// uploaded images serialized as PNG data URLs so a project can be reopened
// later, similar to how clipping jobs are kept around.
const thumbnailTransformSchema = z.object({
  x: z.coerce.number(),
  y: z.coerce.number(),
  scale: z.coerce.number(),
  rotation: z.coerce.number(),
  // Optional independent height scale and layer opacity (back-compat: omitted
  // means proportional scaling and full opacity).
  scaleY: z.coerce.number().optional(),
  opacity: z.coerce.number().min(0).max(1).optional()
});

const thumbnailTreatmentSchema = z.object({
  cutout: z.coerce.boolean(),
  flip: z.coerce.boolean(),
  stroke: z.coerce.number(),
  strokeColor: z.string(),
  glow: z.coerce.number(),
  shadow: z.coerce.boolean(),
  backlight: z.coerce.boolean(),
  saturate: z.coerce.number(),
  contrast: z.coerce.number(),
  brightness: z.coerce.number()
});

const thumbnailImageSchema = z.object({
  id: z.string(),
  name: z.string(),
  // PNG data URL of the (possibly cut-out) image.
  src: z.string(),
  transform: thumbnailTransformSchema,
  treatment: thumbnailTreatmentSchema,
  locked: z.coerce.boolean().optional(),
  lockAspect: z.coerce.boolean().optional()
});

const thumbnailStickerSchema = z.object({
  id: z.string(),
  type: z.enum(["circle", "arrow", "emoji", "badge"]),
  x: z.coerce.number(),
  y: z.coerce.number(),
  scale: z.coerce.number(),
  rotation: z.coerce.number(),
  color: z.string(),
  text: z.string()
});

export const savedThumbnailSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).default("Untitled thumbnail"),
  // Small JPEG data URL used for the gallery card.
  preview: z.string().default(""),
  title: z.string().default(""),
  overlayText: z.string().default(""),
  // Background style id — kept loose so renaming a style never drops a project.
  style: z.string().default("gradient"),
  paletteIndex: z.coerce.number().int().default(0),
  intensity: z.enum(["subtle", "balanced", "bold"]).default("balanced"),
  emphasis: z.enum(["outline", "highlight-bar", "boxed", "clean"]).default("outline"),
  position: z.enum(["left", "bottom-left", "center"]).default("left"),
  size: z.enum(["small", "medium", "large"]).default("medium"),
  uppercase: z.coerce.boolean().default(true),
  fontId: z.string().default("arial-black"),
  textColor: z.string().default("auto"),
  highlightColor: z.string().default("#ffd34d"),
  textTransform: thumbnailTransformSchema,
  manualLayout: z.coerce.boolean().default(false),
  exportScale: z.coerce.number().default(1),
  // Preferred export dimensions (defaults to the 1280×720 YouTube preset).
  exportWidth: z.coerce.number().int().min(16).max(8192).default(1280),
  exportHeight: z.coerce.number().int().min(16).max(8192).default(720),
  images: z.array(thumbnailImageSchema).default([]),
  stickers: z.array(thumbnailStickerSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
});

// ----- Clip Editor projects -----
// Non-destructive edit instructions layered over a rendered clip. Loose
// .catch/.default usage keeps old saved projects loading after the shape grows.

const captionWordSchema = z.object({
  text: z.string(),
  start: z.coerce.number().min(0),
  end: z.coerce.number().min(0)
});

const captionSegmentSchema = z.object({
  id: z.string(),
  start: z.coerce.number().min(0),
  end: z.coerce.number().min(0),
  text: z.string(),
  words: z.array(captionWordSchema).default([]),
  enabled: z.coerce.boolean().default(true)
});

export const captionStyleSchema = z.object({
  fontFamily: z.string().default("Inter, system-ui, sans-serif"),
  fontScale: z.coerce.number().min(0.02).max(0.2).default(0.06),
  fontWeight: z.coerce.number().int().min(100).max(900).default(800),
  textColor: z.string().default("#ffffff"),
  highlightColor: z.string().default("#7c5cff"),
  backgroundColor: z.string().default("#000000"),
  backgroundOpacity: z.coerce.number().min(0).max(1).default(0.4),
  outlineWidth: z.coerce.number().min(0).max(10).default(2),
  shadow: z.coerce.number().min(0).max(10).default(2),
  position: z.enum(["top", "middle", "bottom", "lower-third"]).default("bottom"),
  alignment: z.enum(["left", "center", "right"]).default("center"),
  maxWordsPerCaption: z.coerce.number().int().min(1).max(40).default(7),
  wordsPerLine: z.coerce.number().int().min(1).max(20).default(4),
  animation: z.enum(["none", "fade", "pop", "karaoke"]).default("fade"),
  uppercase: z.coerce.boolean().default(false)
});

export const defaultCaptionStyle = captionStyleSchema.parse({});

const overlaySchema = z.object({
  id: z.string(),
  kind: z.enum(["text", "title", "image", "logo", "watermark"]),
  text: z.string().optional(),
  // Image overlays carry a data URL; cap so the JSON store stays sane.
  src: z.string().max(8_000_000).optional(),
  x: z.coerce.number().default(0.5),
  y: z.coerce.number().default(0.5),
  scale: z.coerce.number().min(0.05).max(8).default(1),
  rotation: z.coerce.number().default(0),
  opacity: z.coerce.number().min(0).max(1).default(1),
  z: z.coerce.number().int().default(0),
  locked: z.coerce.boolean().default(false),
  start: z.coerce.number().min(0).default(0),
  end: z.coerce.number().min(0).default(0),
  color: z.string().optional(),
  background: z.string().optional(),
  fontFamily: z.string().optional(),
  fontWeight: z.coerce.number().int().optional(),
  align: z.enum(["left", "center", "right"]).optional()
});

const clipAudioSchema = z.object({
  clipVolume: z.coerce.number().min(0).max(2).default(1),
  fadeIn: z.coerce.number().min(0).max(10).default(0),
  fadeOut: z.coerce.number().min(0).max(10).default(0),
  musicSrc: z.string().max(20_000_000).optional(),
  musicName: z.string().optional(),
  musicVolume: z.coerce.number().min(0).max(2).default(0.5)
});

export const defaultClipAudio = clipAudioSchema.parse({});

const clipExportSettingsSchema = z.object({
  preset: z.enum(["shorts", "longform", "square", "portrait", "custom"]).default("shorts"),
  width: z.coerce.number().int().min(64).max(4096).default(1080),
  height: z.coerce.number().int().min(64).max(4096).default(1920),
  fps: z.coerce.number().int().min(1).max(120).default(30),
  quality: z.enum(["high", "medium", "low"]).default("high"),
  format: z.enum(["mp4", "webm"]).default("mp4"),
  burnCaptions: z.coerce.boolean().default(true),
  separateSubtitle: z.coerce.boolean().default(false),
  watermark: z.coerce.boolean().default(false),
  filename: z.string().default("clip")
});

export const defaultClipExportSettings = clipExportSettingsSchema.parse({});

const aiSuggestionSchema = z.object({
  id: z.string(),
  start: z.coerce.number().min(0),
  end: z.coerce.number().min(0),
  score: z.coerce.number().default(0),
  rationale: z.string().default(""),
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  addedToTimeline: z.coerce.boolean().default(false)
});

export const clipProjectSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).default("Untitled clip"),
  jobId: z.string(),
  sourceFile: z.string(),
  sourceUrl: z.string().default(""),
  baseDurationSec: z.coerce.number().min(0).default(0),
  baseWidth: z.coerce.number().int().min(1).default(1080),
  baseHeight: z.coerce.number().int().min(1).default(1920),
  clipStart: z.coerce.number().min(0).default(0),
  clipEnd: z.coerce.number().min(0).default(0),
  aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5", "custom"]).default("9:16"),
  reframe: z
    .object({
      scale: z.coerce.number().min(0.1).max(8).default(1),
      offsetX: z.coerce.number().min(-1).max(1).default(0),
      offsetY: z.coerce.number().min(-1).max(1).default(0)
    })
    .default({ scale: 1, offsetX: 0, offsetY: 0 }),
  captions: z.array(captionSegmentSchema).default([]),
  captionStyle: captionStyleSchema.default(defaultCaptionStyle),
  captionsVisible: z.coerce.boolean().default(true),
  highlightCurrentWord: z.coerce.boolean().default(false),
  overlays: z.array(overlaySchema).default([]),
  audio: clipAudioSchema.default(defaultClipAudio),
  exportSettings: clipExportSettingsSchema.default(defaultClipExportSettings),
  suggestions: z.array(aiSuggestionSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const appDataSchema = z.object({
  holdings: z.array(holdingSchema),
  watchlist: z.array(watchlistSchema),
  researchNotes: z.array(researchNoteSchema),
  goals: z.array(goalSchema),
  accounts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.enum(["TFSA", "RRSP", "FHSA", "Cash", "Non-Registered", "Crypto Wallet", "Other"]),
      institution: z.string().optional(),
      currency: z.string()
    })
  ),
  portfolioSnapshots: z.array(
    z.object({
      date: z.string(),
      totalValue: z.coerce.number()
    })
  ),
  expenses: z.array(expenseSchema).default([]),
  contentItems: z.array(contentItemSchema).default([]),
  creatorProfile: creatorProfileSchema.default(defaultCreatorProfile),
  xStrategy: xStrategySchema.default(defaultXStrategy),
  settings: settingsSchema,
  executionGoals: z.array(executionGoalSchema).default([]),
  executionCompletions: z.array(executionCompletionSchema).default([]),
  executionPeriods: z.array(executionPeriodSchema).default([]),
  executionDebt: z.array(executionDebtSchema).default([]),
  executionSeededAt: z.string().optional(),
  savedThumbnails: z.array(savedThumbnailSchema).default([]),
  clipProjects: z.array(clipProjectSchema).default([])
});

export const importHoldingSchema = z.object({
  ticker: z.string().trim().min(1),
  name: z.string().trim().min(1),
  assetClass: z.string().trim().min(1),
  account: z.string().trim().min(1),
  quantity: z.coerce.number().min(0),
  averageCost: z.coerce.number().min(0),
  currentPrice: z.coerce.number().min(0).optional(),
  notes: z.string().optional()
});
