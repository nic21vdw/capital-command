import type { AppData } from "@/types/domain";

const now = "2026-05-01T09:00:00.000Z";

export const seedData: AppData = {
  settings: {
    currency: "CAD",
    theme: "dark"
  },
  accounts: [
    { id: "acct-tfsa", name: "Wealthsimple TFSA", type: "TFSA", institution: "Wealthsimple", currency: "CAD" },
    { id: "acct-rrsp", name: "Questrade RRSP", type: "RRSP", institution: "Questrade", currency: "CAD" },
    { id: "acct-cash", name: "Cash Reserve", type: "Cash", institution: "EQ Bank", currency: "CAD" }
  ],
  holdings: [
    {
      id: "h-1",
      ticker: "XEQT",
      name: "iShares Core Equity ETF Portfolio",
      assetClass: "ETFs",
      account: "Wealthsimple TFSA",
      quantity: 185,
      averageCost: 28.4,
      currentPrice: 31.18,
      dividendYield: 2.1,
      notes: "Core global equity position.",
      updatedAt: now
    },
    {
      id: "h-2",
      ticker: "MSFT",
      name: "Microsoft",
      assetClass: "Stocks",
      account: "Questrade RRSP",
      quantity: 18,
      averageCost: 378.55,
      currentPrice: 421.22,
      dividendYield: 0.75,
      notes: "Compounder with AI tailwinds.",
      updatedAt: now
    },
    {
      id: "h-3",
      ticker: "BN",
      name: "Brookfield Corporation",
      assetClass: "Stocks",
      account: "Wealthsimple TFSA",
      quantity: 42,
      averageCost: 52.15,
      currentPrice: 61.74,
      dividendYield: 0.9,
      notes: "Long-term capital allocator.",
      updatedAt: now
    },
    {
      id: "h-4",
      ticker: "CASH",
      name: "High Interest Savings ETF",
      assetClass: "Cash",
      account: "Cash Reserve",
      quantity: 140,
      averageCost: 50,
      currentPrice: 50.12,
      dividendYield: 4.8,
      notes: "Liquidity bucket.",
      updatedAt: now
    },
    {
      id: "h-5",
      ticker: "BTC",
      name: "Bitcoin",
      assetClass: "Crypto",
      account: "Crypto Wallet",
      quantity: 0.18,
      averageCost: 74200,
      currentPrice: 89500,
      notes: "Small high-volatility sleeve.",
      updatedAt: now
    }
  ],
  watchlist: [
    {
      id: "w-1",
      ticker: "ATD",
      name: "Alimentation Couche-Tard",
      assetClass: "Stocks",
      currentPrice: 83.14,
      targetBuyPrice: 76,
      reason: "Durable operator with steady compounding profile.",
      riskRating: 2,
      convictionRating: 4,
      notes: "Watch valuation on pullbacks.",
      dateAdded: "2026-04-14T12:00:00.000Z"
    },
    {
      id: "w-2",
      ticker: "QQQM",
      name: "Invesco NASDAQ 100 ETF",
      assetClass: "ETFs",
      currentPrice: 210.42,
      targetBuyPrice: 197,
      reason: "Possible growth tilt in RRSP.",
      riskRating: 3,
      convictionRating: 3,
      notes: "Compare with existing US equity exposure.",
      dateAdded: "2026-04-22T12:00:00.000Z"
    }
  ],
  researchNotes: [
    {
      id: "n-1",
      title: "Microsoft moat review",
      relatedTicker: "MSFT",
      thesis: "Strong enterprise distribution and recurring revenue support long-duration compounding.",
      bullCase: "Azure, Office, and AI attach rates deepen customer lock-in.",
      bearCase: "Multiple compression if AI monetization disappoints.",
      keyRisks: "Regulatory pressure, cloud competition, execution risk.",
      valuationThoughts: "Premium quality deserves premium multiple, but position sizing matters.",
      sourceLinks: ["https://www.microsoft.com/investor"],
      tags: ["quality", "cloud", "ai"],
      body: "## Thesis\nMicrosoft remains a high-quality compounder.\n\n## What to watch\n- Azure growth durability\n- Copilot monetization\n- Margin discipline",
      createdAt: "2026-04-10T15:00:00.000Z",
      updatedAt: "2026-04-22T18:00:00.000Z"
    },
    {
      id: "n-2",
      title: "House down payment glidepath",
      thesis: "Reduce volatility for capital needed within 3 years.",
      bullCase: "Higher savings rate shortens timeline and reduces sequence risk.",
      bearCase: "Over-allocating to equities could hurt timing.",
      keyRisks: "Housing price drift, lifestyle inflation.",
      valuationThoughts: "Not valuation-driven; this is about liquidity planning.",
      sourceLinks: [],
      tags: ["goal", "cash-management"],
      body: "Keep near-term funds in lower-volatility vehicles and revisit monthly.",
      createdAt: "2026-04-18T15:00:00.000Z",
      updatedAt: "2026-04-18T15:00:00.000Z"
    }
  ],
  goals: [
    {
      id: "g-1",
      goalName: "Retirement portfolio",
      targetAmount: 1500000,
      currentAmount: 184200,
      targetDate: "2045-12-31",
      notes: "Long-term core investing target."
    },
    {
      id: "g-2",
      goalName: "House down payment",
      targetAmount: 120000,
      currentAmount: 42800,
      targetDate: "2029-06-30",
      notes: "Blend of cash and short-duration holdings."
    },
    {
      id: "g-3",
      goalName: "Emergency fund",
      targetAmount: 30000,
      currentAmount: 18600,
      targetDate: "2027-03-31",
      notes: "Keep in high-interest savings or cash ETFs."
    }
  ],
  portfolioSnapshots: [
    { date: "2026-04-24", totalValue: 32040 },
    { date: "2026-04-25", totalValue: 32210 },
    { date: "2026-04-26", totalValue: 31980 },
    { date: "2026-04-27", totalValue: 32610 },
    { date: "2026-04-28", totalValue: 33080 },
    { date: "2026-04-29", totalValue: 33340 },
    { date: "2026-04-30", totalValue: 33720 },
    { date: "2026-05-01", totalValue: 34190 }
  ],
  creatorProfile: {
    channelName: "Capital Command",
    platform: "YouTube",
    subscribers: 740,
    totalViews: 92400,
    watchHours: 3120,
    monetized: false,
    subscriberGoal: 1000,
    monthlyRevenueGoal: 1500,
    updatedAt: now
  },
  contentItems: [
    {
      id: "c-1",
      title: "How I track my portfolio every Sunday",
      type: "Video",
      platform: "YouTube",
      status: "Published",
      publishDate: "2026-04-27",
      url: "https://youtube.com",
      views: 8420,
      likes: 612,
      comments: 87,
      watchHours: 410,
      revenue: 142.5,
      notes: "Best performing upload this month. Make a follow-up.",
      createdAt: "2026-04-20T12:00:00.000Z",
      updatedAt: "2026-04-28T12:00:00.000Z"
    },
    {
      id: "c-2",
      title: "Live market open + Q&A",
      type: "Stream",
      platform: "YouTube",
      status: "Published",
      publishDate: "2026-04-30",
      views: 1960,
      likes: 188,
      comments: 240,
      watchHours: 520,
      revenue: 64.2,
      notes: "Strong chat engagement. Schedule weekly.",
      createdAt: "2026-04-29T12:00:00.000Z",
      updatedAt: "2026-04-30T22:00:00.000Z"
    },
    {
      id: "c-3",
      title: "3 ETFs I'd buy and hold for 20 years",
      type: "Video",
      platform: "YouTube",
      status: "Editing",
      publishDate: "2026-05-04",
      notes: "B-roll done. Needs thumbnail + chapters.",
      createdAt: "2026-04-28T12:00:00.000Z",
      updatedAt: "2026-05-01T09:00:00.000Z"
    },
    {
      id: "c-4",
      title: "TFSA vs RRSP in 60 seconds",
      type: "Short",
      platform: "YouTube",
      status: "Scripting",
      notes: "Hook: 'You're probably using the wrong account.'",
      createdAt: "2026-05-01T08:00:00.000Z",
      updatedAt: "2026-05-01T08:00:00.000Z"
    },
    {
      id: "c-5",
      title: "Reacting to my worst stock picks",
      type: "Video",
      platform: "YouTube",
      status: "Idea",
      notes: "Vulnerable + educational angle. Could perform well.",
      createdAt: "2026-05-01T08:30:00.000Z",
      updatedAt: "2026-05-01T08:30:00.000Z"
    }
  ]
};
