import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ChannelHubPage } from "@/components/channels/channel-hub-page";
import { CHANNELS, CHANNEL_IDS, isChannelId } from "@/lib/channels/platforms";

export function generateStaticParams() {
  return CHANNEL_IDS.map((channel) => ({ channel }));
}

export async function generateMetadata({ params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  const label = isChannelId(channel) ? CHANNELS[channel].label : "Channel";
  return {
    title: `${label} | Nic Vandewetering`,
    description: `Everything scheduled for ${label}: short clips, long-form videos, carousels and text posts on one calendar.`
  };
}

export default async function Page({ params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  if (!isChannelId(channel)) notFound();

  return (
    <AppShell>
      <ChannelHubPage channel={channel} />
    </AppShell>
  );
}
