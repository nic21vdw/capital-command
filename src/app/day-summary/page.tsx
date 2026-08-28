import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { DaySummaryRoute } from "@/components/master-calendar/day-summary-route";

export const metadata = {
  title: "Day Summary | Capital Command",
  description:
    "One day's distribution as a briefing: every short, carousel, thread and long-form piece going out, what state it is in, and where to manage it."
};

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <DaySummaryRoute />
      </Suspense>
    </AppShell>
  );
}
