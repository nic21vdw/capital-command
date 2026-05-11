import { NextRequest, NextResponse } from "next/server";
import { getMarketDataProvider } from "@/lib/marketData";

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker");
  const range = request.nextUrl.searchParams.get("range") ?? "1m";
  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  try {
    const data = await getMarketDataProvider().getHistoricalPrices(ticker, range);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Unable to fetch historical data" }, { status: 502 });
  }
}
