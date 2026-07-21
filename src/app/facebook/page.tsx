import { AppShell } from "@/components/layout/app-shell";
import { FacebookPage } from "@/components/facebook/facebook-page";

export const metadata = {
  title: "Facebook / Instagram | Nic Vandewetering",
  description: "Thread-format content engine for Facebook and Instagram: text hooks, image posts, and reels with the content continued in the comments."
};

export default function Page() {
  return (
    <AppShell>
      <FacebookPage />
    </AppShell>
  );
}
