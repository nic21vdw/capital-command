import type { BillingMetric, BillingOverview, PaymentBreakdownItem, TrendPoint } from "@/types/domain";
import { getMockBillingOverview } from "@/lib/billing/mock";

const STRIPE_API = "https://api.stripe.com/v1";

interface StripeCharge {
  amount: number;
  amount_refunded: number;
  currency: string;
  created: number;
  status: string;
  paid: boolean;
  refunded: boolean;
  outcome?: { risk_level?: string } | null;
}

interface StripeSubscription {
  status: string;
}

async function stripeGet<T>(path: string, key: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${STRIPE_API}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Stripe request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function trendFromBuckets(buckets: Map<string, number>): TrendPoint[] {
  return Array.from(buckets.entries()).map(([label, value]) => ({
    label,
    value: Math.round((value / 100) * 100) / 100
  }));
}

function makeMetric(amount: number, previousAmount: number, trend: TrendPoint[]): BillingMetric {
  const changePercent = previousAmount === 0 ? 0 : ((amount - previousAmount) / previousAmount) * 100;
  return { amount, previousAmount, changePercent: Math.round(changePercent * 100) / 100, trend };
}

/**
 * Builds a billing overview from live Stripe data when STRIPE_SECRET_KEY is set,
 * and falls back to representative mock data otherwise. Network or auth failures
 * also fall back to mock so the dashboard always renders.
 */
export async function getBillingOverview(currency: "CAD" | "USD" = "USD"): Promise<BillingOverview> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return getMockBillingOverview(currency);
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - 30 * 24 * 60 * 60;
    const prevStart = now - 60 * 24 * 60 * 60;

    const [charges, subscriptions] = await Promise.all([
      stripeGet<{ data: StripeCharge[] }>("/charges", key, {
        limit: "100",
        "created[gte]": String(prevStart)
      }),
      stripeGet<{ data: StripeSubscription[] }>("/subscriptions", key, {
        status: "active",
        limit: "100"
      })
    ]);

    const buckets = new Map<string, number>();
    const netBuckets = new Map<string, number>();
    let grossCurrent = 0;
    let grossPrevious = 0;
    let netCurrent = 0;
    let netPrevious = 0;
    let highRisk = 0;
    const breakdownTotals: Record<string, number> = {
      Succeeded: 0,
      Refunded: 0,
      Blocked: 0,
      Failed: 0
    };

    for (const charge of charges.data) {
      const inCurrent = charge.created >= windowStart;
      const gross = charge.amount;
      const net = charge.amount - charge.amount_refunded;
      if (inCurrent) {
        grossCurrent += gross;
        netCurrent += net;
        const k = dayKey(charge.created);
        buckets.set(k, (buckets.get(k) ?? 0) + gross);
        netBuckets.set(k, (netBuckets.get(k) ?? 0) + net);
      } else {
        grossPrevious += gross;
        netPrevious += net;
      }
      if (charge.outcome?.risk_level === "highest" || charge.outcome?.risk_level === "elevated") {
        highRisk += 1;
      }
      if (charge.status === "succeeded" && charge.paid) breakdownTotals.Succeeded += net;
      if (charge.refunded || charge.amount_refunded > 0) breakdownTotals.Refunded += charge.amount_refunded;
      if (charge.status === "failed") breakdownTotals.Failed += gross;
    }

    const activeCount = subscriptions.data.length;
    const mrr = subscriptions.data.length ? grossCurrent / 100 : 0;

    const breakdown: PaymentBreakdownItem[] = [
      { label: "Succeeded", amount: breakdownTotals.Succeeded / 100, color: "#7c5cff" },
      { label: "Refunded", amount: breakdownTotals.Refunded / 100, color: "#3fb6c4" },
      { label: "Blocked", amount: breakdownTotals.Blocked / 100, color: "#f0a64e" },
      { label: "Failed", amount: breakdownTotals.Failed / 100, color: "#e1556d" }
    ];

    return {
      source: "stripe",
      currency,
      updatedAt: new Date().toISOString(),
      grossVolume: makeMetric(grossCurrent / 100, grossPrevious / 100, trendFromBuckets(buckets)),
      netVolume: makeMetric(netCurrent / 100, netPrevious / 100, trendFromBuckets(netBuckets)),
      mrr: makeMetric(mrr, mrr, trendFromBuckets(buckets)),
      mrrGrowthRate: makeMetric(0, 0, []),
      activeSubscribers: makeMetric(activeCount, activeCount, []),
      churnRate: makeMetric(0, 0, []),
      paymentBreakdown: breakdown,
      disputes: 0,
      highRiskPayments: highRisk
    };
  } catch {
    return getMockBillingOverview(currency);
  }
}

export function hasStripeKey(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
