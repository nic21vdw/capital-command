import { NextResponse } from "next/server";
import { derivePortfolioSummary } from "@/lib/derive";
import { ensureExecution } from "@/lib/execution/server";
import { readAppData, writeAppData } from "@/lib/storage/store";

export async function GET() {
  const stored = await readAppData();

  // Seed default execution goals and reconcile any ended weeks into debt before
  // the dashboard renders, persisting the result so reconciliation is durable.
  const ensured = ensureExecution(stored);
  const data = ensured.data;
  if (ensured.changed) {
    await writeAppData(data);
  }

  return NextResponse.json({
    data,
    summary: derivePortfolioSummary(data),
    apiStatus: {
      hasAlphaVantageKey: Boolean(process.env.ALPHA_VANTAGE_API_KEY)
    }
  });
}
