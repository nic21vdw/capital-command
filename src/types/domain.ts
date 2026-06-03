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

export interface Settings {
  currency: "CAD" | "USD";
  theme: "light" | "dark" | "system";
  accentTheme?: AccentTheme;
}

export interface AppData {
  holdings: Holding[];
  watchlist: WatchlistItem[];
  researchNotes: ResearchNote[];
  goals: Goal[];
  accounts: Account[];
  portfolioSnapshots: PortfolioSnapshot[];
  expenses: Expense[];
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
