import { AppShell } from "@/components/layout/app-shell";
import { MusicStudioPage } from "@/components/music/music-studio-page";

export const metadata = { title: "Music Studio | CoLateral Marketing" };

export default function Page() {
  return (
    <AppShell>
      <MusicStudioPage />
    </AppShell>
  );
}
