import { addDays, formatISO } from "date-fns";
import type { HistoricalPricePoint, PriceData } from "@/types/domain";
import type { MarketDataProvider } from "@/lib/marketData/types";

const mockQuotes: Record<string, number> = {
  XEQT: 31.18,
  MSFT: 421.22,
  BN: 61.74,
  CASH: 50.12,
  BTC: 89500,
  ATD: 83.14,
  QQQM: 210.42
};

export class MockMarketDataProvider implements MarketDataProvider {
  async getQuote(ticker: string): Promise<PriceData> {
    const price = mockQuotes[ticker.toUpperCase()] ?? 100;
    return {
      ticker: ticker.toUpperCase(),
      price,
      change: 1.24,
      changePercent: 0.82,
      lastUpdated: new Date().toISOString(),
      source: "mock"
    };
  }

  async getHistoricalPrices(): Promise<HistoricalPricePoint[]> {
    return Array.from({ length: 30 }).map((_, index) => ({
      date: formatISO(addDays(new Date("2026-04-01"), index), { representation: "date" }),
      value: 100 + index * 1.8 + (index % 4) * 3
    }));
  }

  async searchSymbol(query: string) {
    return Object.keys(mockQuotes)
      .filter((ticker) => ticker.includes(query.toUpperCase()))
      .map((ticker) => ({ ticker, name: `${ticker} mock result` }));
  }

  async getCompanyOverview(ticker: string) {
    return {
      ticker: ticker.toUpperCase(),
      description: "Mock company overview used when no API key is configured.",
      sector: "Technology"
    };
  }
}
