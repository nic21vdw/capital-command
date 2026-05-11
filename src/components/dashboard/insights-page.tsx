"use client";

import { AllocationDonutChart } from "@/components/charts/allocation-donut-chart";
import { AssetClassBarChart } from "@/components/charts/asset-class-bar-chart";
import { HoldingPerformanceChart } from "@/components/charts/holding-performance-chart";
import { useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatCurrency } from "@/lib/utils";

export function DashboardInsightsPage() {
  const { data, summary } = useAppData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Insights"
        title="Portfolio observations"
        description="Neutral, high-level portfolio context to help you review whether your current positioning still matches your plan."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InsightCard title="Largest position" body={`Your largest holding is ${summary.largestPositionPercentage.toFixed(2)}% of the portfolio.`} />
        <InsightCard title="Concentration risk" body={`Current concentration risk reads as ${summary.concentrationRisk.toLowerCase()}. Consider reviewing whether this matches your plan.`} />
        <InsightCard title="Cash percentage" body={`Cash-like positions represent ${summary.cashPercentage.toFixed(2)}% of the portfolio.`} />
        <InsightCard title="Annual dividends" body={`Estimated annual dividends are ${formatCurrency(summary.estimatedAnnualDividends, data.settings.currency)} based on available yield data.`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <h2 className="text-xl font-semibold text-white">Asset class split</h2>
          <AllocationDonutChart data={summary.assetAllocation} />
        </Card>
        <Card>
          <h2 className="text-xl font-semibold text-white">Account split</h2>
          <AssetClassBarChart data={summary.accountAllocation} />
        </Card>
        <Card>
          <h2 className="text-xl font-semibold text-white">Holding performance</h2>
          <HoldingPerformanceChart data={summary.holdings} />
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="text-xl font-semibold text-white">Top gainers and losers</h2>
          <div className="mt-4 space-y-3">
            {summary.holdings
              .sort((a, b) => b.gainLossPercent - a.gainLossPercent)
              .slice(0, 5)
              .map((holding) => (
                <div key={holding.id} className="flex items-center justify-between rounded-2xl border border-white/8 bg-black/20 p-3">
                  <div>
                    <p className="font-medium text-white">{holding.ticker}</p>
                    <p className="text-sm text-[var(--muted-foreground)]">{holding.name}</p>
                  </div>
                  <Badge>{holding.gainLossPercent.toFixed(2)}%</Badge>
                </div>
              ))}
          </div>
        </Card>
        <Card>
          <h2 className="text-xl font-semibold text-white">Missing data</h2>
          <div className="mt-4 space-y-3">
            {summary.holdingsMissingData.length ? (
              summary.holdingsMissingData.map((holding) => (
                <div key={holding.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                  <p className="font-medium text-white">{holding.ticker}</p>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    Current price unavailable. Manual override can keep calculations intact.
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-[var(--muted-foreground)]">
                No holdings are currently missing price data.
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function InsightCard({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <p className="text-sm text-[var(--muted-foreground)]">{title}</p>
      <p className="mt-3 text-lg text-white">{body}</p>
    </Card>
  );
}
