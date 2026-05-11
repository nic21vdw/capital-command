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

export interface AppData {
  holdings: Holding[];
  watchlist: WatchlistItem[];
  researchNotes: ResearchNote[];
  goals: Goal[];
  accounts: Account[];
  portfolioSnapshots: PortfolioSnapshot[];
  settings: Settings;
}
