import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { InboxPage } from "@/components/inbox/inbox-page";

export const metadata = { title: "Inbox | CoLateral Marketing" };

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <InboxPage />
      </Suspense>
    </AppShell>
  );
}
