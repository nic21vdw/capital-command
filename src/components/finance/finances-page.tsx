"use client";

import { ChartPie, CreditCard, Flag, Sparkles, WalletCards } from "lucide-react";
import { FinancePage } from "@/components/finance/finance-page";
import { HoldingsPage } from "@/components/holdings/holdings-page";
import { WatchlistPage } from "@/components/watchlist/watchlist-page";
import { GoalsPage } from "@/components/goals/goals-page";
import { DashboardInsightsPage } from "@/components/dashboard/insights-page";
import { Tabs } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useAppData } from "@/components/providers/app-provider";

/**
 * The personal finance screens, behind the switch that decides whether this
 * install has them at all.
 *
 * They are a portfolio tracker that grew up in the same app as the publishing
 * pipeline, and they are not what this pack sells - a buyer opening a social
 * tool and finding a brokerage dashboard is reading a different product. The
 * four routes that used to be their own pages redirect into this one's tabs,
 * so gating here covers all five without five copies of the check.
 */
export function FinancesPage() {
  const { data } = useAppData();

  if (data.settings.personalDashboard !== true) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Not enabled"
          title="Personal finance"
          description="Billing, holdings, watchlist, goals and insights are turned off on this install."
        />
        <Card>
          <p className="text-sm text-[var(--muted-foreground)]">
            These screens track a portfolio rather than a channel, so they are off unless you ask for them. Turn them
            on under Settings → Personal finance. Nothing has been deleted — whatever is in them is still there.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <Tabs
      tabs={[
        { id: "billing", label: "Billing", icon: CreditCard, content: <FinancePage /> },
        { id: "holdings", label: "Holdings", icon: WalletCards, content: <HoldingsPage /> },
        { id: "watchlist", label: "Watchlist", icon: ChartPie, content: <WatchlistPage /> },
        { id: "goals", label: "Goals", icon: Flag, content: <GoalsPage /> },
        { id: "insights", label: "Insights", icon: Sparkles, content: <DashboardInsightsPage /> }
      ]}
    />
  );
}
