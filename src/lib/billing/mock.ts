import type { BillingMetric, BillingOverview, TrendPoint } from "@/types/domain";

const dayLabels = Array.from({ length: 22 }, (_, index) => `May ${index + 10}`);

function buildTrend(base: number, drift: number, volatility: number, seed: number): TrendPoint[] {
  let value = base;
  let state = seed;
  return dayLabels.map((label) => {
    // Small deterministic pseudo-random walk so charts look organic but stable.
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const noise = (state / 0x7fffffff - 0.5) * volatility;
    value = Math.max(0, value + drift + noise);
    return { label, value: Math.round(value * 100) / 100 };
  });
}

function makeMetric(current: number, previous: number, trend: TrendPoint[]): BillingMetric {
  const changePercent = previous === 0 ? 0 : ((current - previous) / previous) * 100;
  return {
    amount: current,
    previousAmount: previous,
    changePercent: Math.round(changePercent * 100) / 100,
    trend
  };
}

export function getMockBillingOverview(currency: "CAD" | "USD" = "USD"): BillingOverview {
  return {
    source: "mock",
    currency,
    updatedAt: new Date().toISOString(),
    grossVolume: makeMetric(26710.03, 27342.58, buildTrend(900, 12, 1400, 7)),
    netVolume: makeMetric(22577.84, 23574.65, buildTrend(780, 8, 1300, 11)),
    mrr: makeMetric(17325.86, 14291.68, buildTrend(7000, 520, 900, 3)),
    mrrGrowthRate: makeMetric(24.86, 157.14, buildTrend(200, -7, 30, 5)),
    activeSubscribers: makeMetric(611, 503, buildTrend(470, 7, 12, 9)),
    churnRate: makeMetric(31.5, 33.73, buildTrend(33, -0.1, 2, 13)),
    paymentBreakdown: [
      { label: "Succeeded", amount: 24157.02, color: "#7c5cff" },
      { label: "Uncaptured", amount: 0, color: "#9b87ff" },
      { label: "Refunded", amount: 1901.5, color: "#3fb6c4" },
      { label: "Blocked", amount: 2273.5, color: "#f0a64e" },
      { label: "Failed", amount: 2035.45, color: "#e1556d" }
    ],
    disputes: 6,
    highRiskPayments: 48
  };
}
