import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { OutliersPage } from "@/components/outliers/outliers-page";

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <OutliersPage />
      </Suspense>
    </AppShell>
  );
}
