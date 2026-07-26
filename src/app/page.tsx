import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { PipelinePage } from "@/components/pipeline/pipeline-page";

/**
 * The front door is the Stream Pipeline: paste a link or drop a file and every
 * format falls out below it. Every other page in the app is one of those
 * formats, or where they go — so this is the only sensible landing page.
 * `/pipeline` still resolves and redirects here.
 */
export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <PipelinePage />
      </Suspense>
    </AppShell>
  );
}
