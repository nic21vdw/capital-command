import type { HistoricalPricePoint, PriceData } from "@/types/domain";

export interface MarketDataProvider {
  getQuote(ticker: string): Promise<PriceData>;
  getHistoricalPrices(ticker: string, range: string): Promise<HistoricalPricePoint[]>;
  searchSymbol(query: string): Promise<Array<{ ticker: string; name: string }>>;
  getCompanyOverview(ticker: string): Promise<{ ticker: string; description: string; sector?: string }>;
}
