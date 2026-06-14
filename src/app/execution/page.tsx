import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ExecutionPage } from "@/components/execution/execution-page";

export default function Page() {
  return (
    <AppShell>
      <Suspense>
        <ExecutionPage />
      </Suspense>
    </AppShell>
  );
}
