import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { IdeasPage } from "@/components/ideas/ideas-page";

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <IdeasPage />
      </Suspense>
    </AppShell>
  );
}
