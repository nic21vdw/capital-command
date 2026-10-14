import { AppShell } from "@/components/layout/app-shell";
import { PerformancePage } from "@/components/performance/performance-page";

export const metadata = {
  title: "Performance | CoLateral Marketing",
  description: "How every published post performed: views, engagement and trend per platform, synced every 6 hours."
};

export default function Page() {
  return (
    <AppShell>
      <PerformancePage />
    </AppShell>
  );
}
