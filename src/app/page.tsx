import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { PipelinePage } from "@/components/pipeline/pipeline-page";

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <PipelinePage />
      </Suspense>
    </AppShell>
  );
}
