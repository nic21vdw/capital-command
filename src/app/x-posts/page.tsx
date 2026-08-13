import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { XPostsPage } from "@/components/x-posts/x-posts-page";

export const metadata = {
  title: "X / Threads Posts | Nic Vandewetering",
  description: "A day of on-brand Threads posts and replies, generated and scheduled in two presses."
};

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <XPostsPage />
      </Suspense>
    </AppShell>
  );
}
