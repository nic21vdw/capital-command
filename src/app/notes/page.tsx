import { AppShell } from "@/components/layout/app-shell";
import { NotesPage } from "@/components/notes/notes-page";

export default function Page() {
  return (
    <AppShell>
      <NotesPage />
    </AppShell>
  );
}
