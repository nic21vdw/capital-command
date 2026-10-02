import type { BillingMetric, BillingOverview, PaymentBreakdownItem, TrendPoint } from "@/types/domain";
import { getMockBillingOverview } from "@/lib/billing/mock";

const STRIPE_API = "https://api.stripe.com/v1";

interface StripeCharge {
  id: string;
  amount: number;
  amount_captured?: number;
  amount_refunded: number;
  currency: string;
  created: number;
  status: string;
  paid: boolean;
  captured?: boolean;
  refunded: boolean;
  outcome?: { risk_level?: string; type?: string } | null;
}

interface StripeSubscription {
  id: string;
  status: string;
  currency: string;
  items?: { data: Array<{
    quantity?: number | null;
    price: {
      currency: string;
      unit_amount: number | null;
      recurring?: { interval: "day" | "week" | "month" | "year"; interval_count: number; usage_type?: string } | null;
    };
  }> };
}

async function stripeGet<T>(path: string, key: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${STRIPE_API}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new Error(`Stripe request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function stripeList<T extends { id: string }>(path: string, key: string, params: Record<string, string>): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await stripeGet<{ data: T[]; has_more?: boolean }>(path, key, {
      ...params, limit: "100", ...(cursor ? { starting_after: cursor } : {})
    });
    items.push(...page.data);
    if (!page.has_more) return items;
    const next = page.data.at(-1)?.id;
    if (!next || next === cursor) throw new Error("Stripe pagination did not advance.");
    cursor = next;
  }
}

/** Contracted recurring base prices; one-time sales never become MRR. */
function monthlyRecurringCents(subscriptions: StripeSubscription[], currency: string): number {
  return subscriptions.reduce((total, subscription) => total + (subscription.items?.data ?? []).reduce((sum, item) => {
    const { price } = item;
    const recurring = price.recurring;
    if (price.currency.toLowerCase() !== currency || price.unit_amount === null || !recurring || recurring.usage_type === "metered") return sum;
    const count = recurring.interval_count;
    if (!(count > 0)) return sum;
    const annualPeriods = { day: 365, week: 52, month: 12, year: 1 }[recurring.interval];
    return sum + price.unit_amount * (item.quantity ?? 1) * annualPeriods / (12 * count);
  }, 0), 0);
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
      stripeList<StripeCharge>("/charges", key, {
        "created[gte]": String(prevStart),
        "created[lte]": String(now)
      }),
      stripeList<StripeSubscription>("/subscriptions", key, {
        status: "active"
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
      Uncaptured: 0,
      Refunded: 0,
      Blocked: 0,
      Failed: 0
    };

    // Stripe lists newest first. The chart must read oldest to newest, and a
    // currency selector must filter native amounts rather than relabel them.
    const currencyCode = currency.toLowerCase();
    for (const charge of charges.filter((item) => item.currency.toLowerCase() === currencyCode).sort((a, b) => a.created - b.created)) {
      const inCurrent = charge.created >= windowStart;
      const succeeded = charge.status === "succeeded" && charge.paid && charge.captured !== false;
      const gross = charge.amount_captured ?? charge.amount;
      const net = Math.max(0, gross - charge.amount_refunded);
      if (succeeded) {
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
      }
      if (!inCurrent) continue;
      if (charge.outcome?.risk_level === "highest" || charge.outcome?.risk_level === "elevated") {
        highRisk += 1;
      }
      if (succeeded) breakdownTotals.Succeeded += net;
      if (charge.paid && charge.captured === false) breakdownTotals.Uncaptured += charge.amount;
      if (charge.refunded || charge.amount_refunded > 0) breakdownTotals.Refunded += charge.amount_refunded;
      if (charge.outcome?.type === "blocked") breakdownTotals.Blocked += charge.amount;
      else if (charge.status === "failed") breakdownTotals.Failed += charge.amount;
    }

    const activeSubscriptions = subscriptions.filter((subscription) => subscription.status === "active" && subscription.currency.toLowerCase() === currencyCode);
    const activeCount = activeSubscriptions.length;
    const mrr = Math.round(monthlyRecurringCents(activeSubscriptions, currencyCode)) / 100;

    const breakdown: PaymentBreakdownItem[] = [
      { label: "Succeeded", amount: breakdownTotals.Succeeded / 100, color: "#7c5cff" },
      { label: "Uncaptured", amount: breakdownTotals.Uncaptured / 100, color: "#9b87ff" },
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
      mrr: makeMetric(mrr, mrr, []),
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
