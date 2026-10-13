import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ListeningPage } from "@/components/listening/listening-page";

export const metadata = { title: "Listening | CoLateral Marketing" };

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <ListeningPage />
      </Suspense>
    </AppShell>
  );
}
