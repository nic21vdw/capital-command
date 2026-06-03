export type AssetClass =
  | "Stocks"
  | "ETFs"
  | "Crypto"
  | "Cash"
  | "Bonds"
  | "Funds"
  | "REITs"
  | "Other";

export type AccountType =
  | "TFSA"
  | "RRSP"
  | "FHSA"
  | "Cash"
  | "Non-Registered"
  | "Crypto Wallet"
  | "Other";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institution?: string;
  currency: string;
}

export interface Holding {
  id: string;
  ticker: string;
  name: string;
  assetClass: AssetClass;
  account: string;
  quantity: number;
  averageCost: number;
  currentPrice?: number;
  manualPrice?: number;
  dividendYield?: number;
  notes?: string;
  updatedAt: string;
}

export interface WatchlistItem {
  id: string;
  ticker: string;
  name: string;
  assetClass: AssetClass;
  currentPrice?: number;
  targetBuyPrice?: number;
  reason: string;
  riskRating: number;
  convictionRating: number;
  notes?: string;
  dateAdded: string;
}

export interface ResearchNote {
  id: string;
  title: string;
  relatedTicker?: string;
  thesis: string;
  bullCase: string;
  bearCase: string;
  keyRisks: string;
  valuationThoughts: string;
  sourceLinks: string[];
  tags: string[];
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Goal {
  id: string;
  goalName: string;
  targetAmount: number;
  currentAmount: number;
  targetDate?: string;
  monthlyContribution?: number;
  notes?: string;
}

export interface PriceData {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  lastUpdated: string;
  source: "alpha-vantage" | "mock" | "manual";
}

export interface HistoricalPricePoint {
  date: string;
  value: number;
}

export interface PortfolioSnapshot {
  date: string;
  totalValue: number;
}

export interface Settings {
  currency: "CAD" | "USD";
  theme: "light" | "dark" | "system";
}

export type ContentType = "Video" | "Short" | "Stream" | "Podcast";

export type ContentPlatform = "YouTube" | "Twitch" | "TikTok" | "Instagram" | "Other";

export type ContentStatus = "Idea" | "Scripting" | "Recording" | "Editing" | "Scheduled" | "Published";

export interface ContentItem {
  id: string;
  title: string;
  type: ContentType;
  platform: ContentPlatform;
  status: ContentStatus;
  publishDate?: string;
  url?: string;
  views?: number;
  likes?: number;
  comments?: number;
  watchHours?: number;
  revenue?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorProfile {
  channelName: string;
  platform: ContentPlatform;
  subscribers: number;
  totalViews: number;
  watchHours: number;
  monetized: boolean;
  subscriberGoal: number;
  monthlyRevenueGoal: number;
  updatedAt: string;
}

export interface AppData {
  holdings: Holding[];
  watchlist: WatchlistItem[];
  researchNotes: ResearchNote[];
  goals: Goal[];
  accounts: Account[];
  portfolioSnapshots: PortfolioSnapshot[];
  contentItems: ContentItem[];
  creatorProfile: CreatorProfile;
  settings: Settings;
}
