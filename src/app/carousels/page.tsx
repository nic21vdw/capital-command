import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { CarouselsPage } from "@/components/carousels/carousels-page";

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <CarouselsPage />
      </Suspense>
    </AppShell>
  );
}
