import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { DistributionPage } from "@/components/distribution/distribution-page";

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <DistributionPage />
      </Suspense>
    </AppShell>
  );
}
