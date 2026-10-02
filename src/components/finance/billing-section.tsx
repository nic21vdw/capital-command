"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/finance/overview?currency=${currency}`, {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)])
      });
      if (!response.ok) throw new Error(`Billing data could not load (HTTP ${response.status}).`);
      const json = (await response.json()) as OverviewResponse;
      if (!json?.overview || json.overview.currency !== currency || !json.apiStatus) {
        throw new Error("The server returned an incomplete billing response.");
      }
      if (sequence !== requestSequence.current) return;
      setOverview(json.overview);
      setHasKey(json.apiStatus.hasStripeKey);
    } catch (failure) {
      if (controller.signal.aborted || sequence !== requestSequence.current) return;
      setError(failure instanceof Error ? failure.message : "Billing data could not load.");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [currency]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      activeRequest.current?.abort();
      requestSequence.current += 1;
    };
  }, [load]);

  if (loading) {
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

  if (error || !overview) {
    return <Card className="space-y-3">
      <p role="alert" className="text-sm text-[var(--danger)]">{error ?? "Billing data could not load."}</p>
      <Button variant="secondary" onClick={() => void load()}>Retry</Button>
    </Card>;
  }

  const fmt = (value: number) => formatCurrency(value, overview.currency);
  const live = overview.source === "stripe";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-[var(--accent)]" />
          <h2 className="text-xl font-semibold text-white">Stripe billing overview</h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={overview.source === "stripe" ? "success" : "warning"}>
            {overview.source === "stripe" ? "Live Stripe" : "Sample data"}
          </Badge>
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </div>

      {!hasKey ? (
        <Card className="tone-warning tone-edge tone-soft">
          <p className="text-sm text-white">
            Connect Stripe to see your real numbers. Add <code className="text-[var(--accent)]">STRIPE_SECRET_KEY</code> to
            your environment and refresh. Until then, the dashboard shows sample data.
          </p>
        </Card>
      ) : !live ? <Card className="tone-warning tone-edge tone-soft">
        <p className="text-sm text-white">Stripe data is unavailable. This screen is showing sample data. Check your connection and refresh.</p>
      </Card> : null}

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
        <BillingMetricCard label={live ? "MRR (base-price estimate)" : "MRR"} value={fmt(overview.mrr.amount)} metric={overview.mrr} showHistory={!live} />
        <BillingMetricCard
          label="MRR growth rate"
          value={live ? "Not available" : `${overview.mrrGrowthRate.amount.toFixed(2)}%`}
          metric={overview.mrrGrowthRate}
          showHistory={!live}
        />
        <BillingMetricCard
          label="Active subscribers"
          value={overview.activeSubscribers.amount.toLocaleString()}
          metric={overview.activeSubscribers}
          showHistory={!live}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <BillingMetricCard
          label="Subscriber churn rate"
          value={live ? "Not available" : `${overview.churnRate.amount.toFixed(1)}%`}
          metric={overview.churnRate}
          invertChange
          showHistory={!live}
        />
        <Card className="flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--muted-foreground)]">Disputes</p>
            <TriangleAlert className="h-5 w-5 tone-warning tone-text" />
          </div>
          <p className="text-3xl font-semibold text-white">{live ? "Not available" : overview.disputes}</p>
          <p className="text-sm text-[var(--muted-foreground)]">{live ? "Disputes are not included in this overview" : "Open disputes this period"}</p>
        </Card>
        <Card className="flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--muted-foreground)]">High-risk payments</p>
            <ShieldAlert className="h-5 w-5 tone-danger tone-text" />
          </div>
          <p className="text-3xl font-semibold text-white">{overview.highRiskPayments}</p>
          <p className="text-sm text-[var(--muted-foreground)]">Flagged by Stripe Radar</p>
        </Card>
      </div>
    </div>
  );
}
