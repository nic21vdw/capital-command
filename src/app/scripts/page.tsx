import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ScriptsPage } from "@/components/scripts/scripts-page";

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <ScriptsPage />
      </Suspense>
    </AppShell>
  );
}
