import { NextRequest, NextResponse } from "next/server";
import { getBillingOverview, hasStripeKey } from "@/lib/billing/stripe";

export async function GET(request: NextRequest) {
  const currencyParam = request.nextUrl.searchParams.get("currency");
  const currency = currencyParam === "CAD" ? "CAD" : "USD";
  const overview = await getBillingOverview(currency);

  return NextResponse.json({
    overview,
    apiStatus: {
      hasStripeKey: hasStripeKey()
    }
  });
}
