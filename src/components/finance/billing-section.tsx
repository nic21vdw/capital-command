"use client";

import { useEffect, useState } from "react";
import { CreditCard, ShieldAlert, TriangleAlert } from "lucide-react";
import { PaymentsBreakdownBar } from "@/components/charts/payments-breakdown-bar";
import { BillingMetricCard } from "@/components/finance/billing-metric-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { BillingOverview } from "@/types/domain";
import { formatCurrency } from "@/lib/utils";

interface OverviewResponse {
  overview: BillingOverview;
  apiStatus: { hasStripeKey: boolean };
}

export function BillingSection({ currency }: { currency: "CAD" | "USD" }) {
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/finance/overview?currency=${currency}`, { cache: "no-store" });
      const json = (await response.json()) as OverviewResponse;
      setOverview(json.overview);
      setHasKey(json.apiStatus.hasStripeKey);
    } catch {
      setOverview(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  if (loading || !overview) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-48" />
          ))}
        </div>
      </div>
    );
  }

  const fmt = (value: number) => formatCurrency(value, overview.currency);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-[var(--accent)]" />
          <h2 className="text-xl font-semibold text-white">Stripe billing overview</h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={overview.source === "stripe" ? "text-emerald-300" : "text-amber-200"}>
            {overview.source === "stripe" ? "Live Stripe" : "Sample data"}
          </Badge>
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </div>

      {!hasKey ? (
        <Card className="border-amber-300/20 bg-amber-300/5">
          <p className="text-sm text-white">
            Connect Stripe to see your real numbers. Add <code className="text-[var(--accent)]">STRIPE_SECRET_KEY</code> to
            your environment and refresh — the dashboard falls back to representative sample data until then.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <BillingMetricCard label="Gross volume" value={fmt(overview.grossVolume.amount)} metric={overview.grossVolume} />
        <BillingMetricCard label="Net volume from sales" value={fmt(overview.netVolume.amount)} metric={overview.netVolume} />
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--muted-foreground)]">Payments</p>
            <span className="text-xs text-[var(--muted-foreground)]">
              Updated {new Date(overview.updatedAt).toLocaleDateString()}
            </span>
          </div>
          <PaymentsBreakdownBar items={overview.paymentBreakdown} currency={overview.currency} />
        </Card>
        <BillingMetricCard label="MRR" value={fmt(overview.mrr.amount)} metric={overview.mrr} />
        <BillingMetricCard
          label="MRR growth rate"
          value={`${overview.mrrGrowthRate.amount.toFixed(2)}%`}
          metric={overview.mrrGrowthRate}
        />
        <BillingMetricCard
          label="Active subscribers"
          value={overview.activeSubscribers.amount.toLocaleString()}
          metric={overview.activeSubscribers}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <BillingMetricCard
          label="Subscriber churn rate"
          value={`${overview.churnRate.amount.toFixed(1)}%`}
          metric={overview.churnRate}
          invertChange
        />
        <Card className="flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--muted-foreground)]">Disputes</p>
            <TriangleAlert className="h-5 w-5 text-amber-300" />
          </div>
          <p className="text-3xl font-semibold text-white">{overview.disputes}</p>
          <p className="text-sm text-[var(--muted-foreground)]">Open disputes this period</p>
        </Card>
        <Card className="flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--muted-foreground)]">High-risk payments</p>
            <ShieldAlert className="h-5 w-5 text-red-300" />
          </div>
          <p className="text-3xl font-semibold text-white">{overview.highRiskPayments}</p>
          <p className="text-sm text-[var(--muted-foreground)]">Flagged by Stripe Radar</p>
        </Card>
      </div>
    </div>
  );
}
