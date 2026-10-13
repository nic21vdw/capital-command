import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { FinancesPage } from "@/components/finance/finances-page";

export const metadata = { title: "Personal Finance | CoLateral Marketing" };

export default function Page() {
  return (
    <AppShell>
      <Suspense>
        <FinancesPage />
      </Suspense>
    </AppShell>
  );
}
