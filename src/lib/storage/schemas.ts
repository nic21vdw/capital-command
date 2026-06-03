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

export const settingsSchema = z.object({
  currency: z.enum(["CAD", "USD"]),
  theme: z.enum(["light", "dark", "system"]),
  accentTheme: z.enum(["lime", "stripe", "ocean", "sunset", "rose", "mono"]).optional()
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
