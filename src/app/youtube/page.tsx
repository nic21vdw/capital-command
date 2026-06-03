import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { YouTubePage } from "@/components/creator/youtube-page";

export default function Page() {
  return (
    <AppShell>
      <Suspense>
        <YouTubePage />
      </Suspense>
    </AppShell>
  );
}
