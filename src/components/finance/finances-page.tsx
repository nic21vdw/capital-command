"use client";

import { ChartPie, CreditCard, Flag, Sparkles, WalletCards } from "lucide-react";
import { FinancePage } from "@/components/finance/finance-page";
import { HoldingsPage } from "@/components/holdings/holdings-page";
import { WatchlistPage } from "@/components/watchlist/watchlist-page";
import { GoalsPage } from "@/components/goals/goals-page";
import { DashboardInsightsPage } from "@/components/dashboard/insights-page";
import { Tabs } from "@/components/ui/tabs";

export function FinancesPage() {
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
