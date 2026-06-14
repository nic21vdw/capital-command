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

export type ExpenseCategory =
  | "Hardware"
  | "AI Subscription"
  | "Cloud"
  | "Software"
  | "Peripherals"
  | "Other";

export type ExpenseFrequency = "one-time" | "monthly" | "yearly";

export interface Expense {
  id: string;
  name: string;
  vendor?: string;
  category: ExpenseCategory;
  frequency: ExpenseFrequency;
  amount: number;
  currency: "CAD" | "USD";
  date: string;
  active: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type AccentTheme = "lime" | "stripe" | "ocean" | "sunset" | "rose" | "mono";

export interface UserProfile {
  /** Display name shown in the profile bar. */
  displayName?: string;
  /** Avatar image stored as a data URL. */
  avatar?: string;
}

export interface Settings {
  currency: "CAD" | "USD";
  theme: "light" | "dark" | "system";
  accentTheme?: AccentTheme;
  profile?: UserProfile;
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

export type XActivityType = "reply" | "post";

export interface XActivity {
  id: string;
  type: XActivityType;
  date: string; // YYYY-MM-DD (local day the activity happened)
  account?: string; // for replies: the handle replied to
  topic: string;
  text: string; // the exact reply or post text
  engagement?: string;
  createdAt: string;
}

export interface XStrategy {
  brief: string; // positioning / voice / strategy (markdown)
  dailyReplyTarget: number; // minimum quality replies per day
  dailyPostTarget: number; // minimum original posts per day
  activities: XActivity[];
}

export interface AppData {
  holdings: Holding[];
  watchlist: WatchlistItem[];
  researchNotes: ResearchNote[];
  goals: Goal[];
  accounts: Account[];
  portfolioSnapshots: PortfolioSnapshot[];
  expenses: Expense[];
  contentItems: ContentItem[];
  creatorProfile: CreatorProfile;
  xStrategy: XStrategy;
  settings: Settings;
}

export interface TrendPoint {
  label: string;
  value: number;
}

export interface BillingMetric {
  amount: number;
  previousAmount: number;
  changePercent: number;
  trend: TrendPoint[];
}

export interface PaymentBreakdownItem {
  label: string;
  amount: number;
  color: string;
}

export interface BillingOverview {
  source: "stripe" | "mock";
  currency: "CAD" | "USD";
  updatedAt: string;
  grossVolume: BillingMetric;
  netVolume: BillingMetric;
  mrr: BillingMetric;
  mrrGrowthRate: BillingMetric;
  activeSubscribers: BillingMetric;
  churnRate: BillingMetric;
  paymentBreakdown: PaymentBreakdownItem[];
  disputes: number;
  highRiskPayments: number;
}
