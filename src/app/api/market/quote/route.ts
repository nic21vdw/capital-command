import { NextRequest, NextResponse } from "next/server";
import { getMarketDataProvider } from "@/lib/marketData";

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  try {
    const quote = await getMarketDataProvider().getQuote(ticker);
    return NextResponse.json(quote);
  } catch {
    return NextResponse.json({ error: "Unable to fetch quote" }, { status: 502 });
  }
}
