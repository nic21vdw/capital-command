import { NextResponse } from "next/server";
import { derivePortfolioSummary } from "@/lib/derive";
import { readAppData } from "@/lib/storage/store";

export async function GET() {
  const data = await readAppData();

  return NextResponse.json({
    data,
    summary: derivePortfolioSummary(data),
    apiStatus: {
      hasAlphaVantageKey: Boolean(process.env.ALPHA_VANTAGE_API_KEY)
    }
  });
}
