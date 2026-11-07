import { AppShell } from "@/components/layout/app-shell";
import { XDraftsPage } from "@/components/x-drafts/x-drafts-page";

export const metadata = {
  title: "X Drafts | CoLateral Marketing",
  description: "Fresh X posts in your voice to pick from, each one also posted to Threads on its own."
};

export default function Page() {
  return (
    <AppShell>
      <XDraftsPage />
    </AppShell>
  );
}
