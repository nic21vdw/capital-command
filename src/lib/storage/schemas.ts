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
  theme: z.enum(["light", "dark", "system"]),
  accentTheme: z.enum(["lime", "stripe", "ocean", "sunset", "rose", "mono"]).optional(),
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
  executionSeededAt: z.string().optional()
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
