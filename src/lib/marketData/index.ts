import { AlphaVantageMarketDataProvider } from "@/lib/marketData/alphaVantage";
import { MockMarketDataProvider } from "@/lib/marketData/mock";

export function getMarketDataProvider() {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    return new MockMarketDataProvider();
  }
  return new AlphaVantageMarketDataProvider(apiKey);
}
