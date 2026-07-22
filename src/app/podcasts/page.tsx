import { AppShell } from "@/components/layout/app-shell";
import { PodcastStudioPage } from "@/components/podcasts/podcast-studio-page";

export const metadata = {
  title: "Podcast Studio | Nic Vandewetering",
  description:
    "Turn livestreams into podcast episodes, topic cuts, RSS releases and scheduled audio distribution.",
};

export default function Page() {
  return (
    <AppShell>
      <PodcastStudioPage />
    </AppShell>
  );
}
