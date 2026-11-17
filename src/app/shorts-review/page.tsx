import { AppShell } from "@/components/layout/app-shell";
import { ShortsReviewPage } from "@/components/shorts-review/shorts-review-page";

export const metadata = {
  title: "Weekly Shorts Review | CoLateral Marketing",
  description: "Every finished Short from recent streams that is not booked yet, best first, to tick and book in one pass."
};

export default function Page() {
  return (
    <AppShell>
      <ShortsReviewPage />
    </AppShell>
  );
}
