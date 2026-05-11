import { NextRequest, NextResponse } from "next/server";
import { getMarketDataProvider } from "@/lib/marketData";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("query");
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  try {
    const data = await getMarketDataProvider().searchSymbol(query);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Unable to search symbols" }, { status: 502 });
  }
}
