import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { LongformStudioPage } from "@/components/longform/longform-page";

export default function Page() {
  return (
    <AppShell>
      {/* useSearchParams (deep-link ?open=) requires a Suspense boundary. */}
      <Suspense fallback={null}>
        <LongformStudioPage />
      </Suspense>
    </AppShell>
  );
}
