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

/** Reusable brand images (data URLs) shared by every clip project: upload a
 *  logo/watermark once, then toggle it on in any clip editor. */
export const brandAssetsSchema = z.object({
  logoSrc: z.string().max(8_000_000).optional(),
  watermarkSrc: z.string().max(8_000_000).optional()
});

export const defaultBrandAssets = brandAssetsSchema.parse({});

export const settingsSchema = z.object({
  currency: z.enum(["CAD", "USD"]),
  /**
   * Whether a stream the nightly scan takes in may book itself into the publish
   * queue and the Threads queue while nobody is watching. OFF unless he says
   * otherwise: everything else in this app stops at "ready to schedule", and
   * booking a run means AI-written titles and posts can reach his channel
   * without him having read them.
   */
  autoScheduleOvernight: z.coerce.boolean().optional(),
  // Unknown/legacy values (e.g. old accent ids) gracefully fall back to undefined,
  // and the UI resolves that to the default preset at runtime.
  themePreset: z.enum(["slate", "midnight", "graphite", "forest", "dracula", "paper", "arctic"]).optional().catch(undefined),
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

// ----- X / Threads daily post planner -----
export const xSuggestedPostSchema = z.object({
  id: z.string(),
  slot: z.coerce.number().int().min(1),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Expected HH:MM"),
  format: z.enum(["insight", "contrarian", "story", "question", "framework", "observation"]),
  topic: z.string().trim().min(1),
  text: z.string().trim().min(1),
  threadsVariant: z.string().trim().min(1)
});

export const xSuggestedReplySchema = z.object({
  id: z.string(),
  scenario: z.string().trim().min(1),
  text: z.string().trim().min(1)
});

export const xDailyPackSchema = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  focus: z.string().optional(),
  source: z.enum(["ai", "library"]),
  posts: z.array(xSuggestedPostSchema),
  replies: z.array(xSuggestedReplySchema),
  requestedAt: z.string().optional(),
  createdAt: z.string()
});

export const xPlannerSchema = z.object({
  packs: z.array(xDailyPackSchema).default([])
});

export const defaultXPlanner = xPlannerSchema.parse({});

// ----- Video Studio: idea discovery, scripts, carousels -----
export const videoIdeaSchema = z.object({
  id: z.string(),
  seedKeyword: z.string().trim().default(""),
  title: z.string().trim().min(1),
  angle: z.string().trim().default(""),
  format: z.enum(["longform", "short", "both"]).default("longform"),
  primaryKeyword: z.string().trim().default(""),
  keywords: z.array(z.string()).default([]),
  searchIntent: z.enum(["tutorial", "case-study", "opinion", "story", "comparison", "news"]).default("tutorial"),
  competition: z.enum(["low", "medium", "high"]).default("medium"),
  score: z.coerce.number().min(0).max(100).default(50),
  rationale: z.string().default(""),
  status: z.enum(["suggested", "saved", "scripted", "archived"]).default("suggested"),
  source: z.enum(["ai", "library", "manual"]).default("ai"),
  createdAt: z.string().default(() => new Date().toISOString())
});

export const scriptGraphicSchema = z.object({
  id: z.string(),
  sectionId: z.string().default(""),
  kind: z.enum(["b-roll", "screen-recording", "diagram", "text-overlay", "meme", "photo"]).default("b-roll"),
  description: z.string().trim().min(1),
  status: z.enum(["suggested", "accepted", "dismissed"]).default("suggested")
});

export const scriptSfxSchema = z.object({
  id: z.string(),
  sectionId: z.string().default(""),
  cue: z.string().trim().min(1),
  sound: z.string().trim().default(""),
  status: z.enum(["suggested", "accepted", "dismissed"]).default("suggested")
});

export const scriptSectionSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1),
  purpose: z.string().default(""),
  content: z.string().default("")
});

export const videoScriptSchema = z.object({
  id: z.string(),
  ideaId: z.string().optional(),
  title: z.string().trim().min(1),
  targetMinutes: z.coerce.number().min(1).max(180).default(8),
  sections: z.array(scriptSectionSchema).default([]),
  graphics: z.array(scriptGraphicSchema).default([]),
  sfx: z.array(scriptSfxSchema).default([]),
  status: z.enum(["draft", "ready", "produced"]).default("draft"),
  source: z.enum(["ai", "manual"]).default("ai"),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString())
});

// ----- Facebook / Instagram content strategy -----
// Default playbook brief shown (and editable) in the Facebook tool the first
// time it loads; persisted in the app data store like the X brief.
export const DEFAULT_FB_BRIEF = `# Facebook / Instagram Content Brief

## Setup
Personal profile switched to Professional Mode — unlocks analytics and reach without needing a separate page. Instagram runs the same playbook: hook post or reel, thread continued in the caption + pinned comments.

## Format mix (benchmark: 1.4B organic views)
- Text-only posts drove 78.2% of views — black background, white text, clickbait headline, down-pointing emoji (👇)
- Image with text — same hook discipline, the image carries the headline
- Reels — short-form video, cross-posted to Instagram

## Thread format
The main post is only the hook. The content continues in the comment section as a numbered thread (1/, 2/, 3/ …). Facebook orders comments by relevance, not chronology, so engagement on the thread comments keeps the whole post surfacing.

## Back-end rule
Every post must have a back-end system for business — subscribers, affiliate sales, or product traffic. The call to action always goes in the comment section as the final numbered comment, never in the main post.

## Voice
- Specific, confident, practical — written like a sharp engineer who understands business
- Hooks promise a concrete outcome ("grew my client's channel by 100,000 subscribers in 30 days")
- Each thread comment is one self-contained step or insight
- No hashtags in main posts; keep links out of the hook and in the CTA comment`;

export const fbThreadCommentSchema = z.object({
  id: z.string(),
  text: z.string().trim().min(1)
});

export const fbPostSchema = z.object({
  id: z.string(),
  platform: z.enum(["facebook", "instagram"]),
  format: z.enum(["text", "imageText", "reel"]),
  status: z.enum(["draft", "posted"]).default("draft"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hook: z.string().trim().min(1),
  body: z.string().default(""),
  mediaUrl: z.string().optional(),
  mediaName: z.string().optional(),
  threadComments: z.array(fbThreadCommentSchema).default([]),
  cta: z.string().default(""),
  views: z.coerce.number().min(0).optional(),
  reactions: z.coerce.number().min(0).optional(),
  comments: z.coerce.number().min(0).optional(),
  shares: z.coerce.number().min(0).optional(),
  notes: z.string().default(""),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString())
});

const slideTextLayerSchema = z.object({
  id: z.string(),
  type: z.literal("text"),
  text: z.string().default(""),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  fontSize: z.number(),
  color: z.string().default("#ffffff"),
  weight: z.number().default(700),
  align: z.enum(["left", "center", "right"]).default("left"),
  rotation: z.number().optional()
});

const slideImageLayerSchema = z.object({
  id: z.string(),
  type: z.literal("image"),
  src: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  radius: z.number().optional(),
  rotation: z.number().optional(),
  fit: z.enum(["cover", "contain", "frame"]).optional()
});

export const slideLayerSchema = z.discriminatedUnion("type", [slideTextLayerSchema, slideImageLayerSchema]);

export const carouselSlideSchema = z.object({
  id: z.string(),
  heading: z.string().default(""),
  body: z.string().default(""),
  background: z.string().optional(),
  headingColor: z.string().optional(),
  bodyColor: z.string().optional(),
  hideBaseText: z.boolean().optional(),
  scrim: z.number().min(0).max(1).optional(),
  textBand: z.object({ top: z.number(), bottom: z.number() }).optional(),
  layers: z.array(slideLayerSchema).optional()
});

export const carouselBatchSchema = z.object({
  groupId: z.string(),
  index: z.number().int().min(1),
  total: z.number().int().min(1),
  angle: z.string().optional()
});

export const carouselScheduleSchema = z.object({
  id: z.string(),
  platforms: z.array(z.enum(["youtube", "instagram", "tiktok", "facebook"])).default([]),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  recurrence: z.enum(["once", "daily", "weekly"]).default("once"),
  date: z.string(),
  weekday: z.number().int().min(0).max(6).optional(),
  caption: z.string().optional(),
  createdAt: z.string().default(() => new Date().toISOString())
});

export const carouselSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1),
  sourceType: z.enum(["script", "longform", "short", "custom", "images"]).default("custom"),
  sourceId: z.string().optional(),
  slides: z.array(carouselSlideSchema).default([]),
  aspectRatio: z.enum(["portrait", "square", "story", "landscape"]).optional(),
  schedules: z.array(carouselScheduleSchema).optional(),
  batch: carouselBatchSchema.optional(),
  createdAt: z.string().default(() => new Date().toISOString())
});

// Higgsfield avatar videos: real footage of Nic, driven by an AI avatar —
// no lines to deliver, the "acting" comes from the generated motion/scene.
export const avatarVideoSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1).default("Avatar video"),
  prompt: z.string().default(""),
  status: z.enum(["queued", "processing", "completed", "failed"]).default("queued"),
  externalJobId: z.string().optional(),
  videoUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString())
});

// AI voiceover clips generated in Nic's cloned voice from typed dialogue.
export const voiceoverSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1).default("Voiceover"),
  script: z.string().default(""),
  status: z.enum(["queued", "processing", "completed", "failed"]).default("queued"),
  audioUrl: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString())
});

// The channel's default script framework. Editable on the Scripts page and
// persisted; every generated script follows whatever the stored version says.
export const DEFAULT_SCRIPT_FRAMEWORK = `# Script Framework

## 1. Hook (first 15-25 seconds)
Open on the payoff or the boldest claim of the video — never an intro, never "hey guys". One or two lines that make the promise concrete ("I built X in Y", "This mistake cost me Z"), then one line of stakes: why this matters to the viewer right now.

## 2. Context & Stakes (20-40 seconds)
The minimum backstory needed to care: what I'm building (CoLateral, AI tools for structural engineers), what the problem was, and what happens if it goes wrong. End with an open loop — name what's coming later so people stay.

## 3. Value Beats (the body — 3 to 5 beats)
Each beat = one concrete thing: a step, a decision, a mistake, a demo. For every beat:
- Show, don't narrate — screen recording or b-roll over the talking.
- One specific detail or number per beat (real, never invented).
- End the beat with a mini-payoff or a turn ("...and that's when it broke").
Keep beats 60-120 seconds each. Order them so tension rises: setup → complication → breakthrough.

## 4. Payoff (30-60 seconds)
Close the loop opened in the hook: the result, the demo of it working, the honest verdict — including what didn't work. This is the part people came for; don't rush it.

## 5. CTA (5-10 seconds)
One ask only: subscribe for the next build video, or watch the next video in the journey. Say it like a person, not an ad. No "smash that like button".

## Voice rules
- Sharp engineer who understands business — confident, specific, plain words.
- Short sentences. Contractions. First person, present tense where possible.
- No hype adjectives, no invented numbers, no motivational-influencer tone.`;

export const videoStudioSchema = z.object({
  framework: z.string().default(DEFAULT_SCRIPT_FRAMEWORK),
  ideas: z.array(videoIdeaSchema).default([]),
  scripts: z.array(videoScriptSchema).default([]),
  carousels: z.array(carouselSchema).default([])
});

export const defaultVideoStudio = videoStudioSchema.parse({});

export const fbStrategySchema = z.object({
  brief: z.string().default(DEFAULT_FB_BRIEF),
  posts: z.array(fbPostSchema).default([])
});

export const defaultFbStrategy = fbStrategySchema.parse({});

// ----- Product launches (Launch Pad) -----
export const launchCopySchema = z.object({
  name: z.string().default(""),
  tagline: z.string().default(""),
  description: z.string().default(""),
  firstComment: z.string().default(""),
  topics: z.array(z.string()).default([]),
  galleryCaptions: z.array(z.string()).default([]),
  socialPosts: z.array(z.object({ surface: z.string(), text: z.string() })).default([]),
  generatedAt: z.string().default(() => new Date().toISOString()),
  aiGenerated: z.boolean().default(false)
});

export const launchStatsSchema = z.object({
  votes: z.coerce.number().default(0),
  comments: z.coerce.number().default(0),
  rank: z.coerce.number().nullable().default(null),
  dayLaunchCount: z.coerce.number().nullable().default(null),
  name: z.string().default(""),
  tagline: z.string().default(""),
  url: z.string().default(""),
  featuredAt: z.string().nullable().default(null),
  fetchedAt: z.string().default(() => new Date().toISOString())
});

export const productLaunchSchema = z.object({
  id: z.string(),
  product: z.string().trim().min(1).default("CoLateral"),
  productUrl: z.string().default(""),
  launchDate: z.string(),
  status: z.enum(["planning", "scheduled", "live", "done"]).default("planning"),
  slug: z.string().optional(),
  hunter: z.string().optional(),
  notes: z.string().optional(),
  copy: launchCopySchema.optional(),
  stats: launchStatsSchema.optional(),
  completedTasks: z.array(z.string()).default([]),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString())
});

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

export const captionSegmentSchema = z.object({
  id: z.string(),
  start: z.coerce.number().min(0),
  end: z.coerce.number().min(0),
  text: z.string(),
  words: z.array(captionWordSchema).default([]),
  enabled: z.coerce.boolean().default(true)
});

// Defaults follow the short-form captioning style popularized by CapCut /
// Opus Clip: big bold outlined words in short phrases, no caption box, the
// spoken word highlighted, sitting in the lower third of a 9:16 frame.
export const captionStyleSchema = z.object({
  fontFamily: z.string().default("Inter, system-ui, sans-serif"),
  fontScale: z.coerce.number().min(0.02).max(0.2).default(0.052),
  fontWeight: z.coerce.number().int().min(100).max(900).default(800),
  textColor: z.string().default("#ffffff"),
  highlightColor: z.string().default("#ffd34d"),
  backgroundColor: z.string().default("#000000"),
  backgroundOpacity: z.coerce.number().min(0).max(1).default(0),
  outlineWidth: z.coerce.number().min(0).max(10).default(3),
  shadow: z.coerce.number().min(0).max(10).default(2),
  position: z.enum(["top", "middle", "bottom", "lower-third"]).default("lower-third"),
  alignment: z.enum(["left", "center", "right"]).default("center"),
  maxWordsPerCaption: z.coerce.number().int().min(1).max(40).default(4),
  wordsPerLine: z.coerce.number().int().min(1).max(20).default(4),
  animation: z.enum(["none", "fade", "pop", "karaoke"]).default("pop"),
  uppercase: z.coerce.boolean().default(false),
  // Free caption placement from dragging on the preview (overrides `position`).
  offsetX: z.coerce.number().min(0).max(1).optional(),
  offsetY: z.coerce.number().min(0).max(1).optional()
});

export const defaultCaptionStyle = captionStyleSchema.parse({});

const overlaySchema = z.object({
  id: z.string(),
  // Legacy "title" overlays (removed) load back in as plain text.
  kind: z.preprocess((v) => (v === "title" ? "text" : v), z.enum(["text", "image", "logo", "watermark"])),
  text: z.string().optional(),
  // Image overlays carry a data URL; cap so the JSON store stays sane.
  src: z.string().max(8_000_000).optional(),
  x: z.coerce.number().default(0.5),
  y: z.coerce.number().default(0.5),
  scale: z.coerce.number().min(0.05).max(8).default(1),
  // Text-box wrapping width as a fraction of the frame; omitted on legacy
  // overlays, which fall back to the auto width.
  width: z.coerce.number().min(0.05).max(2).optional(),
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

// Auto-placed viral sound effects; shared by the clip and long-form editors.
export const sfxSettingsSchema = z.object({
  enabled: z.coerce.boolean().default(false),
  sensitivity: z.enum(["subtle", "balanced", "aggressive"]).default("balanced"),
  volume: z.coerce.number().min(0).max(2).default(0.9),
  sounds: z
    .object({
      vineBoom: z.coerce.boolean().default(true),
      fa: z.coerce.boolean().default(true),
      amongUs: z.coerce.boolean().default(true)
    })
    .default({ vineBoom: true, fa: true, amongUs: true })
});

export const defaultSfxSettings = sfxSettingsSchema.parse({});

// Shorts/Reels-first: clips default to a 1080x1920 vertical export so a fresh
// project is publishable straight from the editor with no extra setup.
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

const clipEditSegmentSchema = z.object({
  id: z.string(),
  start: z.coerce.number().min(0),
  end: z.coerce.number().min(0),
  kind: z.enum(["speech", "silence"]),
  enabled: z.coerce.boolean().default(true)
});

export const clipProjectSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).default("Untitled clip"),
  jobId: z.string(),
  sourceFile: z.string(),
  posterFile: z.string().optional(),
  sourceUrl: z.string().default(""),
  baseDurationSec: z.coerce.number().min(0).default(0),
  baseWidth: z.coerce.number().int().min(1).default(1920),
  baseHeight: z.coerce.number().int().min(1).default(1080),
  clipStart: z.coerce.number().min(0).default(0),
  clipEnd: z.coerce.number().min(0).default(0),
  trimStart: z.coerce.number().min(0).default(0),
  trimEnd: z.coerce.number().min(0).default(0),
  segments: z.array(clipEditSegmentSchema).max(1000).default([]),
  title: z.string().default(""),
  // Editable posting copy shown in the editor's Description dropdown; optional
  // so clip projects saved before the field still load.
  description: z.string().max(10000).optional(),
  keywords: z.string().max(2000).optional(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5", "custom"]).default("9:16"),
  compositionMode: z
    .enum(["center-blur", "crop-fill", "stacked-split", "stacked-split-flip", "screen-lead", "face-lead", "fit"])
    .default("center-blur"),
  reframe: z
    .object({
      scale: z.coerce.number().min(0.1).max(8).default(1),
      offsetX: z.coerce.number().min(-1).max(1).default(0),
      offsetY: z.coerce.number().min(-1).max(1).default(0)
    })
    .default({ scale: 1, offsetX: 0, offsetY: 0 }),
  faceSource: z
    .object({
      x: z.coerce.number().min(0).max(1).default(0.58),
      y: z.coerce.number().min(0).max(1).default(0.05),
      w: z.coerce.number().min(0.01).max(1).default(0.42),
      h: z.coerce.number().min(0.01).max(1).default(0.5)
    })
    .optional(),
  screenSource: z
    .object({
      x: z.coerce.number().min(0).max(1).default(0),
      y: z.coerce.number().min(0).max(1).default(0),
      w: z.coerce.number().min(0.01).max(1).default(1),
      h: z.coerce.number().min(0.01).max(1).default(1)
    })
    .optional(),
  // Whether a caller OMITTED captions is read off the raw request body in
  // upsertClipProject, not from here: the payload ships projects without
  // them, and a whole-object upsert that treated that as "empty" would wipe
  // hand-split captions off the stored project. The default keeps every
  // other reader (and AppData itself) free of an optional array.
  captions: z.array(captionSegmentSchema).default([]),
  captionStyle: captionStyleSchema.default(defaultCaptionStyle),
  captionsVisible: z.coerce.boolean().default(true),
  highlightCurrentWord: z.coerce.boolean().default(true),
  overlays: z.array(overlaySchema).default([]),
  audio: clipAudioSchema.default(defaultClipAudio),
  sfx: sfxSettingsSchema.default(defaultSfxSettings),
  exportSettings: clipExportSettingsSchema.default(defaultClipExportSettings),
  suggestions: z.array(aiSuggestionSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Derived server-side on write (see stampProjectSignature). Optional so every
  // project saved before the field still parses; the stamp fills them in.
  renderSignature: z.string().optional(),
  captionCount: z.coerce.number().int().min(0).optional()
});

// ----- Video Clip Creator (non-destructive timeline editor) -----
// A project stores only edit *instructions* against a single stored source
// video, so large files are never duplicated and projects survive a refresh.

const regionRectSchema = z.object({
  x: z.coerce.number().default(0),
  y: z.coerce.number().default(0),
  w: z.coerce.number().default(1),
  h: z.coerce.number().default(1)
});

// How the source sits inside one output frame for a given aspect ratio.
const framingSchema = z.object({
  // fit = letterbox (contain), fill/crop = cover; crop adds manual zoom/pan.
  mode: z.enum(["fit", "fill", "crop"]).default("fill"),
  // Pan as a fraction of the frame (-1..1), independent zoom, rotation in deg.
  x: z.coerce.number().default(0),
  y: z.coerce.number().default(0),
  scale: z.coerce.number().min(0.1).max(8).default(1),
  rotation: z.coerce.number().default(0),
  // Portion of the *source* shown by the primary layer (screen-focused crops).
  srcRect: regionRectSchema.default({ x: 0, y: 0, w: 1, h: 1 })
});

// Optional second region of the same source (e.g. the webcam) composited on
// top — drives the camera-above / below / side-by-side livestream layouts.
const cameraOverlaySchema = z.object({
  enabled: z.coerce.boolean().default(false),
  srcRect: regionRectSchema.default({ x: 0.7, y: 0, w: 0.3, h: 0.3 }),
  destRect: regionRectSchema.default({ x: 0, y: 0, w: 1, h: 0.35 }),
  radius: z.coerce.number().min(0).max(50).default(0)
});

const clipBackgroundSchema = z.object({
  type: z.enum(["blur", "color"]).default("blur"),
  color: z.string().default("#000000")
});

export const videoClipSchema = z.object({
  id: z.string(),
  // Trim points into the source, in seconds. Non-destructive.
  sourceStart: z.coerce.number().min(0).default(0),
  sourceEnd: z.coerce.number().min(0).default(0),
  volume: z.coerce.number().min(0).max(2).default(1),
  muted: z.coerce.boolean().default(false),
  speed: z.coerce.number().min(0.25).max(4).default(1),
  fadeIn: z.coerce.number().min(0).default(0),
  fadeOut: z.coerce.number().min(0).default(0),
  background: clipBackgroundSchema.default({ type: "blur", color: "#000000" }),
  layoutPreset: z.string().default("none"),
  camera: cameraOverlaySchema.default({
    enabled: false,
    srcRect: { x: 0.7, y: 0, w: 0.3, h: 0.3 },
    destRect: { x: 0, y: 0, w: 1, h: 0.35 },
    radius: 0
  }),
  // Framing kept separately per aspect-ratio id so switching ratios is lossless.
  framing: z.record(z.string(), framingSchema).default({})
});

const videoSourceSchema = z.object({
  id: z.string(),
  kind: z.enum(["upload", "url"]).default("upload"),
  fileName: z.string().default("source"),
  url: z.string().optional(),
  mime: z.string().default("video/mp4"),
  durationSec: z.coerce.number().min(0).default(0),
  width: z.coerce.number().min(0).default(0),
  height: z.coerce.number().min(0).default(0),
  hasAudio: z.coerce.boolean().default(true),
  sizeBytes: z.coerce.number().min(0).default(0)
});

const aspectRatioSchema = z.object({
  preset: z.enum(["9:16", "16:9", "1:1", "4:5", "custom"]).default("9:16"),
  w: z.coerce.number().min(1).default(9),
  h: z.coerce.number().min(1).default(16)
});

export const videoProjectSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).default("Untitled project"),
  source: videoSourceSchema.nullable().default(null),
  aspect: aspectRatioSchema.default({ preset: "9:16", w: 9, h: 16 }),
  exportPreset: z.string().default("short-1080x1920"),
  clips: z.array(videoClipSchema).default([]),
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
  xPlanner: xPlannerSchema.default(defaultXPlanner),
  fbStrategy: fbStrategySchema.default(defaultFbStrategy),
  settings: settingsSchema,
  executionGoals: z.array(executionGoalSchema).default([]),
  executionCompletions: z.array(executionCompletionSchema).default([]),
  executionPeriods: z.array(executionPeriodSchema).default([]),
  executionDebt: z.array(executionDebtSchema).default([]),
  executionSeededAt: z.string().optional(),
  savedThumbnails: z.array(savedThumbnailSchema).default([]),
  clipProjects: z.array(clipProjectSchema).default([]),
  videoProjects: z.array(videoProjectSchema).default([]),
  brandAssets: brandAssetsSchema.default(defaultBrandAssets),
  videoStudio: videoStudioSchema.default(defaultVideoStudio),
  avatarVideos: z.array(avatarVideoSchema).default([]),
  voiceovers: z.array(voiceoverSchema).default([]),
  productLaunches: z.array(productLaunchSchema).default([])
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
