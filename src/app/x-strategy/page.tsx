import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { XStrategyPage } from "@/components/x-strategy/x-strategy-page";

export const metadata = {
  title: "Reply Studio | Nic Vandewetering",
  description: "Daily X/Twitter reply strategy: generate session briefs, track cadence, and log every reply and post."
};

export default function Page() {
  return (
    <AppShell>
      <Suspense>
        <XStrategyPage />
      </Suspense>
    </AppShell>
  );
}
