import { subDays, formatISO } from "date-fns";
import type { HistoricalPricePoint, PriceData } from "@/types/domain";
import type { MarketDataProvider } from "@/lib/marketData/types";

const baseUrl = "https://www.alphavantage.co/query";

const cache = new Map<string, { expiresAt: number; value: unknown }>();

function getCacheTtlMs() {
  const minutes = Number(process.env.MARKET_DATA_CACHE_TTL_MINUTES ?? 30);
  return Math.max(minutes, 1) * 60_000;
}

async function getCached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value as T;
  }

  const value = await fetcher();
  cache.set(key, { value, expiresAt: Date.now() + getCacheTtlMs() });
  return value;
}

async function fetchAlphaVantage(params: Record<string, string>) {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json"
    },
    next: { revalidate: Math.floor(getCacheTtlMs() / 1000) }
  });

  if (!response.ok) {
    throw new Error(`Alpha Vantage request failed with status ${response.status}`);
  }

  const json = (await response.json()) as Record<string, unknown>;

  if ("Note" in json) {
    throw new Error("Alpha Vantage rate limit reached");
  }

  if ("Error Message" in json) {
    throw new Error("Alpha Vantage returned an error");
  }

  return json;
}

export class AlphaVantageMarketDataProvider implements MarketDataProvider {
  constructor(private readonly apiKey: string) {}

  async getQuote(ticker: string): Promise<PriceData> {
    return getCached(`quote:${ticker}`, async () => {
      const json = await fetchAlphaVantage({
        function: "GLOBAL_QUOTE",
        symbol: ticker,
        apikey: this.apiKey
      });

      const quote = json["Global Quote"] as Record<string, string> | undefined;
      if (!quote) {
        throw new Error("Quote payload missing");
      }

      return {
        ticker: ticker.toUpperCase(),
        price: Number(quote["05. price"] ?? 0),
        change: Number(quote["09. change"] ?? 0),
        changePercent: Number(String(quote["10. change percent"] ?? "0").replace("%", "")),
        lastUpdated: new Date().toISOString(),
        source: "alpha-vantage"
      };
    });
  }

  async getHistoricalPrices(ticker: string, range: string): Promise<HistoricalPricePoint[]> {
    return getCached(`historical:${ticker}`, async () => {
      void range;
      const json = await fetchAlphaVantage({
        function: "TIME_SERIES_DAILY",
        symbol: ticker,
        outputsize: "compact",
        apikey: this.apiKey
      });

      const series = json["Time Series (Daily)"] as Record<string, Record<string, string>> | undefined;
      if (!series) {
        return Array.from({ length: 30 }).map((_, index) => ({
          date: formatISO(subDays(new Date(), 29 - index), { representation: "date" }),
          value: 0
        }));
      }

      return Object.entries(series)
        .slice(0, 30)
        .reverse()
        .map(([date, values]) => ({
          date,
          value: Number(values["4. close"] ?? 0)
        }));
    });
  }

  async searchSymbol(query: string) {
    return getCached(`search:${query}`, async () => {
      const json = await fetchAlphaVantage({
        function: "SYMBOL_SEARCH",
        keywords: query,
        apikey: this.apiKey
      });

      const matches = (json.bestMatches ?? []) as Array<Record<string, string>>;
      return matches.slice(0, 8).map((match) => ({
        ticker: match["1. symbol"] ?? "",
        name: match["2. name"] ?? ""
      }));
    });
  }

  async getCompanyOverview(ticker: string) {
    return getCached(`overview:${ticker}`, async () => {
      const json = await fetchAlphaVantage({
        function: "OVERVIEW",
        symbol: ticker,
        apikey: this.apiKey
      });

      return {
        ticker: ticker.toUpperCase(),
        description: String(json.Description ?? ""),
        sector: String(json.Sector ?? "")
      };
    });
  }
}
