"use client";

import { ArrowDownRight, ArrowUpRight, BriefcaseBusiness, CircleDollarSign, Landmark, NotebookPen } from "lucide-react";
import { AllocationDonutChart } from "@/components/charts/allocation-donut-chart";
import { AssetClassBarChart } from "@/components/charts/asset-class-bar-chart";
import { PortfolioLineChart } from "@/components/charts/portfolio-line-chart";
import { QuoteOfTheDayCard } from "@/components/dashboard/quote-of-the-day-card";
import { useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency, formatPercent } from "@/lib/utils";

export function DashboardPage() {
  const { data, summary, loading } = useAppData();

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-40" />
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dashboard"
        title="Capital Command"
        description="Overview of your portfolio, watchlist, and research notes."
      />
      <QuoteOfTheDayCard />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total portfolio value"
          value={formatCurrency(summary.totalPortfolioValue, data.settings.currency)}
          detail={`${summary.holdings.length} positions tracked`}
          icon={<BriefcaseBusiness className="h-5 w-5" />}
        />
        <StatCard
          label="Daily change"
          value={formatCurrency(summary.dailyChange.amount, data.settings.currency)}
          detail={formatPercent(summary.dailyChange.percent)}
          icon={summary.dailyChange.amount >= 0 ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
        />
        <StatCard
          label="Total gain / loss"
          value={formatCurrency(summary.totalGainLoss, data.settings.currency)}
          detail={formatPercent((summary.totalGainLoss / Math.max(summary.totalCostBasis, 1)) * 100)}
          icon={<CircleDollarSign className="h-5 w-5" />}
        />
        <StatCard
          label="Estimated annual dividends"
          value={formatCurrency(summary.estimatedAnnualDividends, data.settings.currency)}
          detail="Based on available yield data"
          icon={<Landmark className="h-5 w-5" />}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Portfolio value</h2>
              <p className="text-sm text-[var(--muted-foreground)]">Value over time from your saved snapshots.</p>
            </div>
            <Badge>{formatPercent(summary.simplePerformance)}</Badge>
          </div>
          <PortfolioLineChart data={data.portfolioSnapshots} />
        </Card>
        <Card>
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-white">Allocation by asset class</h2>
            <p className="text-sm text-[var(--muted-foreground)]">Current portfolio mix.</p>
          </div>
          <AllocationDonutChart data={summary.assetAllocation} />
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-[0.7fr_1.3fr]">
        <Card>
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-white">Account allocation</h2>
            <p className="text-sm text-[var(--muted-foreground)]">How your capital is distributed across account wrappers.</p>
          </div>
          <div className="space-y-3">
            {summary.accountAllocation.map((account) => (
              <div key={account.name} className="rounded-2xl border border-white/8 bg-[var(--well)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-white">{account.name}</span>
                  <span className="text-sm text-[var(--muted-foreground)]">
                    {formatCurrency(account.value, data.settings.currency)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-white">Asset class snapshot</h2>
            <p className="text-sm text-[var(--muted-foreground)]">Quick bar view of where exposure sits today.</p>
          </div>
          <AssetClassBarChart data={summary.assetAllocation} />
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <h2 className="text-xl font-semibold text-white">Top holdings</h2>
          <div className="mt-4 space-y-3">
            {summary.topHoldings.map((holding) => (
              <div key={holding.id} className="rounded-2xl border border-white/8 bg-[var(--well)] p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-white">{holding.ticker}</p>
                    <p className="text-sm text-[var(--muted-foreground)]">{holding.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-white">{formatCurrency(holding.marketValue, data.settings.currency)}</p>
                    <p className="text-sm text-[var(--muted-foreground)]">{holding.portfolioWeight.toFixed(2)}% weight</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <h2 className="text-xl font-semibold text-white">Biggest movers</h2>
          <div className="mt-4 space-y-3">
            {summary.biggestMovers.map((holding) => (
              <div key={holding.id} className="rounded-2xl border border-white/8 bg-[var(--well)] p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-white">{holding.ticker}</p>
                    <p className="text-sm text-[var(--muted-foreground)]">{holding.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-white">{formatPercent(holding.gainLossPercent)}</p>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      {formatCurrency(holding.gainLoss, data.settings.currency)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <h2 className="text-xl font-semibold text-white">Watchlist and notes</h2>
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-white/8 bg-[var(--well)] p-4">
              <p className="text-sm text-[var(--muted-foreground)]">Watchlist snapshot</p>
              <div className="mt-3 space-y-2">
                {data.watchlist.slice(0, 3).map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-white">
                      {item.ticker} <span className="text-[var(--muted-foreground)]">{item.name}</span>
                    </span>
                    <span className="text-[var(--muted-foreground)]">{formatCurrency(item.currentPrice ?? 0, data.settings.currency)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-[var(--well)] p-4">
              <p className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                <NotebookPen className="h-4 w-4" />
                Recent notes
              </p>
              <div className="mt-3 space-y-3">
                {data.researchNotes.slice(0, 2).map((note) => (
                  <div key={note.id}>
                    <p className="font-medium text-white">{note.title}</p>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">{note.thesis}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
