import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ClipGeneratorPage } from "@/components/clips/clip-generator-page";

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <ClipGeneratorPage />
      </Suspense>
    </AppShell>
  );
}
