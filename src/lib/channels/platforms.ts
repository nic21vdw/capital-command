import { CALENDAR_SOURCE_BY_ID, type MasterCalendarEvent } from "@/lib/master-calendar/types";

/**
 * The Channel Hub's model: one screen per connected social account showing
 * everything already scheduled to go out there.
 *
 * It introduces no new content and no new storage. Every event on a channel
 * page is a MasterCalendarEvent the Master Calendar already aggregates — the
 * hub just answers "which of these land on THIS network?" and "what kind of
 * thing is it?", so the sidebar logo can open a per-network view of the
 * Uploading Center, the carousel schedules and the Threads packs at once.
 */

export type ChannelId = "youtube" | "instagram" | "tiktok" | "facebook" | "threads";

export const CHANNEL_IDS: ChannelId[] = ["youtube", "instagram", "tiktok", "facebook", "threads"];

export type Channel = {
  id: ChannelId;
  label: string;
  /** Brand colour, used for the accent rail and the header wash. */
  color: string;
  /**
   * The platform labels an event may carry for this channel, lowercased.
   * Events name their networks as display strings from several sources (the
   * publish queue's PlatformId labels, a carousel schedule's target list, the
   * content tracker's free-text platform field), so matching is by alias
   * rather than by a shared enum.
   */
  aliases: string[];
  /** Where this channel's posting credentials are managed. */
  manageHref: string;
};

export const CHANNELS: Record<ChannelId, Channel> = {
  youtube: {
    id: "youtube",
    label: "YouTube",
    color: "#ff0000",
    aliases: ["youtube", "yt", "youtube shorts", "shorts"],
    manageHref: "/uploading-center"
  },
  instagram: {
    id: "instagram",
    label: "Instagram",
    color: "#e1306c",
    aliases: ["instagram", "ig", "reels", "instagram reels"],
    manageHref: "/uploading-center"
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    color: "#25f4ee",
    aliases: ["tiktok", "tik tok"],
    manageHref: "/uploading-center"
  },
  facebook: {
    id: "facebook",
    label: "Facebook",
    color: "#1877f2",
    aliases: ["facebook", "fb", "facebook reels"],
    manageHref: "/uploading-center"
  },
  threads: {
    id: "threads",
    label: "Threads",
    color: "#38bdf8",
    aliases: ["threads", "x", "twitter"],
    manageHref: "/x-posts"
  }
};

export function isChannelId(value: string): value is ChannelId {
  return (CHANNEL_IDS as string[]).includes(value);
}

/** Which channel a free-text platform label names, if any. */
export function channelForLabel(label: string): ChannelId | null {
  const needle = label.trim().toLowerCase();
  if (!needle) return null;
  return CHANNEL_IDS.find((id) => CHANNELS[id].aliases.includes(needle)) ?? null;
}

export function eventTargetsChannel(event: MasterCalendarEvent, channel: ChannelId): boolean {
  return event.platforms.some((label) => channelForLabel(label) === channel);
}

/**
 * What a channel page groups by: the shape of the post, not the subsystem that
 * produced it. A creator checking their TikTok page thinks in "clips, videos,
 * carousels, text" — the Master Calendar's source ids are an implementation
 * detail of where each one is edited.
 */
export type ChannelKind = "short" | "longform" | "carousel" | "text";

export const CHANNEL_KINDS: ChannelKind[] = ["short", "longform", "carousel", "text"];

export const CHANNEL_KIND_LABELS: Record<ChannelKind, { singular: string; plural: string }> = {
  short: { singular: "Short clip", plural: "Short clips" },
  longform: { singular: "Long-form video", plural: "Long-form videos" },
  carousel: { singular: "Carousel", plural: "Carousels" },
  text: { singular: "Text post", plural: "Text posts" }
};

export function channelKindOf(event: MasterCalendarEvent): ChannelKind {
  if (event.source === "shorts") return "short";
  if (event.source === "content") return "longform";
  if (event.source === "carousels") return "carousel";
  return "text";
}

/** Where an event of this kind is edited, reusing the Master Calendar's links. */
export function kindHref(kind: ChannelKind): { href: string; label: string } {
  const source = CALENDAR_SOURCE_BY_ID[
    kind === "short" ? "shorts" : kind === "longform" ? "content" : kind === "carousel" ? "carousels" : "x"
  ];
  return { href: source.href, label: source.hrefLabel };
}

export type ChannelKindCount = { kind: ChannelKind; count: number };

export function countByKind(events: MasterCalendarEvent[]): ChannelKindCount[] {
  return CHANNEL_KINDS.map((kind) => ({
    kind,
    count: events.filter((event) => channelKindOf(event) === kind).length
  }));
}

export function sortEvents(events: MasterCalendarEvent[]): MasterCalendarEvent[] {
  return [...events].sort((a, b) => {
    if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
    if (!a.time || !b.time) return a.time ? 1 : b.time ? -1 : 0;
    return a.time.localeCompare(b.time);
  });
}

export type ChannelAccount = {
  /** Display name of the profile this channel posts as. */
  title: string;
  handle: string | null;
  thumbnail: string | null;
};

export type ChannelResponse = {
  channel: ChannelId;
  timezone: string;
  start: string;
  days: number;
  /** How many accounts on this network are signed in. */
  connected: number;
  /** Signed in, but something outside the app still stops it publishing. */
  blocker: string | null;
  account: ChannelAccount | null;
  events: MasterCalendarEvent[];
};
