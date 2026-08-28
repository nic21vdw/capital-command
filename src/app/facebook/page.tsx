import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { FacebookPage } from "@/components/facebook/facebook-page";

export const metadata = {
  title: "FB / IG Threads | Capital Command",
  description: "Thread-format content engine for Facebook and Instagram: text hooks, image posts, and reels with the content continued in the comments."
};

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <FacebookPage />
      </Suspense>
    </AppShell>
  );
}
