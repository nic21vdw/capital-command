import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { LaunchPage } from "@/components/launch/launch-page";

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <LaunchPage />
      </Suspense>
    </AppShell>
  );
}
