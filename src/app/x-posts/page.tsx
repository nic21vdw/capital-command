import { AppShell } from "@/components/layout/app-shell";
import { XPostsPage } from "@/components/x-posts/x-posts-page";

export const metadata = {
  title: "X / Threads Posts | Nic Vandewetering",
  description: "Daily on-brand post and reply suggestions for X and Threads."
};

export default function Page() {
  return (
    <AppShell>
      <XPostsPage />
    </AppShell>
  );
}
