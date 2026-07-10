import { AppShell } from "@/components/layout/app-shell";
import { DeckLoader } from "./deck-loader";

export default function PresentationPage() {
  return (
    <AppShell>
      <DeckLoader />
    </AppShell>
  );
}
