import { AppShell } from "@/components/layout/app-shell";
import { DeckLoader } from "./deck-loader";

export const metadata = { title: "Segment Deck | CoLateral Marketing" };

export default function PresentationPage() {
  return (
    <AppShell>
      <DeckLoader />
    </AppShell>
  );
}
