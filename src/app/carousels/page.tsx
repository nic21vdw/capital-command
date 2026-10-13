import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { CarouselsPage } from "@/components/carousels/carousels-page";

export const metadata = { title: "Carousels & Images | CoLateral Marketing" };

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <CarouselsPage />
      </Suspense>
    </AppShell>
  );
}
