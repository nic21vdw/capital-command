import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { PodcastPage } from "@/components/podcast/podcast-page";

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <PodcastPage />
      </Suspense>
    </AppShell>
  );
}
