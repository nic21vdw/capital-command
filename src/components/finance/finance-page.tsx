"use client";

import { useState } from "react";
import { Palette } from "lucide-react";
import { BillingSection } from "@/components/finance/billing-section";
import { ExpenseSection } from "@/components/finance/expense-section";
import { ThemePicker } from "@/components/finance/theme-picker";
import { useAppData } from "@/components/providers/app-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export function FinancePage() {
  const { data } = useAppData();
  const [showAppearance, setShowAppearance] = useState(false);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Finance"
        title="Finance & billing"
        description="Stripe revenue alongside your spending on AI, cloud, and hardware."
        actions={
          <Button variant="secondary" onClick={() => setShowAppearance((value) => !value)}>
            <Palette className="mr-2 h-4 w-4" />
            Appearance
          </Button>
        }
      />

      {showAppearance ? (
        <Card>
          <ThemePicker compact />
        </Card>
      ) : null}

      <BillingSection currency={data.settings.currency} />
      <ExpenseSection />
    </div>
  );
}
