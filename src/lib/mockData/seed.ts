import { appDataSchema, defaultCreatorProfile, defaultXStrategy } from "@/lib/storage/schemas";
import { DEFAULT_THEME } from "@/lib/themes";
import type { AppData } from "@/types/domain";

const now = "2026-05-01T09:00:00.000Z";

const baseSettings = { currency: "CAD", themePreset: DEFAULT_THEME } as const;

/**
 * What a fresh install opens on: nothing.
 *
 * This file used to hold one person's real records — brokerage accounts,
 * holdings with their actual quantities, an expense ledger down to the receipt
 * and order numbers — and `readAppData` wrote them to disk the first time
 * anyone loaded a page. Someone who installed the app was shown a dashboard of
 * a stranger's money and had no way to know it was not a demo of their own.
 *
 * A fresh document is empty instead. Nothing to mistake for your own data, and
 * nothing to delete before you start.
 */
export const emptyData: AppData = appDataSchema.parse({
  settings: baseSettings,
  accounts: [],
  holdings: [],
  watchlist: [],
  researchNotes: [],
  goals: [],
  portfolioSnapshots: [],
  expenses: [],
  contentItems: [],
  creatorProfile: defaultCreatorProfile,
  xStrategy: defaultXStrategy
});

/**
 * A demo document, reachable only from Settings → "Load demo data".
 *
 * Invented, and obviously so: the channel is a fictional one, the accounts are
 * named for what they are rather than for a bank, and every number is round.
 * It exists so someone can see what a populated screen looks like before they
 * have populated one, and it is never what a first run writes.
 */
export const seedData: AppData = appDataSchema.parse({
  settings: baseSettings,
  xStrategy: defaultXStrategy,
  accounts: [
    { id: "acct-demo-invest", name: "Investment account", type: "Non-Registered", institution: "Demo", currency: "CAD" },
    { id: "acct-demo-cash", name: "Cash reserve", type: "Cash", institution: "Demo", currency: "CAD" }
  ],
  holdings: [],
  watchlist: [],
  researchNotes: [],
  goals: [],
  portfolioSnapshots: [],
  expenses: [],
  creatorProfile: {
    channelName: "Demo Channel",
    platform: "YouTube",
    subscribers: 500,
    totalViews: 50000,
    watchHours: 2000,
    monetized: false,
    subscriberGoal: 1000,
    monthlyRevenueGoal: 1000,
    updatedAt: now
  },
  contentItems: [
    {
      id: "c-demo-1",
      title: "A finished upload, so the Published column is not empty",
      type: "Video",
      platform: "YouTube",
      status: "Published",
      publishDate: "2026-04-27",
      views: 5000,
      likes: 400,
      comments: 50,
      watchHours: 300,
      revenue: 100,
      notes: "Demo row. Delete it once you have uploads of your own.",
      createdAt: "2026-04-20T12:00:00.000Z",
      updatedAt: "2026-04-28T12:00:00.000Z"
    },
    {
      id: "c-demo-2",
      title: "One still being edited",
      type: "Video",
      platform: "YouTube",
      status: "Editing",
      publishDate: "2026-05-04",
      notes: "Demo row.",
      createdAt: "2026-04-28T12:00:00.000Z",
      updatedAt: now
    },
    {
      id: "c-demo-3",
      title: "And one that is still an idea",
      type: "Short",
      platform: "YouTube",
      status: "Idea",
      notes: "Demo row.",
      createdAt: now,
      updatedAt: now
    }
  ]
});
