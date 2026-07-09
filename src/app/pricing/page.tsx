import { AppShell } from "@/components/layout/app-shell";
import { PricingTiers } from "@/components/pricing/pricing-tiers";
import { PageHeader } from "@/components/ui/page-header";

export default function Page() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="CoLateral"
        title="Pricing"
        description="Pay once, own it forever. The price steps up as the first license batches sell, so earlier buyers pay less."
      />
      <PricingTiers />
    </AppShell>
  );
}
