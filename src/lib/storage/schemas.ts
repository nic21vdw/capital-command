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

export const settingsSchema = z.object({
  currency: z.enum(["CAD", "USD"]),
  theme: z.enum(["light", "dark", "system"])
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
  contentItems: z.array(contentItemSchema).default([]),
  creatorProfile: creatorProfileSchema.default(defaultCreatorProfile),
  settings: settingsSchema
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
