import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { OutreachPage } from "@/components/outreach/outreach-page";

export const metadata = { title: "Outreach | CoLateral Marketing" };

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <OutreachPage />
      </Suspense>
    </AppShell>
  );
}
