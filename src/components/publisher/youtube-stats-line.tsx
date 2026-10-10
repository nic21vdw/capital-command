"use client";

import { agoLabel, statsLine, type YoutubeStat, type YoutubeStatsStatus } from "@/lib/publisher/youtubeStatsShared";
import { useYoutubeStats } from "@/lib/publisher/useYoutubeStats";
import { cn } from "@/lib/utils";

/**
 * "1.2K views · 45 likes · 3 comments", and how old that is. When the numbers
 * could not be refreshed (YouTube not connected, or a read failed) the age is
 * worded "last fetched ..." so a stale number never passes for a live one.
 */
export function YoutubeStatsLine({
  stat,
  status,
  now,
  showAge = true,
  className
}: {
  stat: YoutubeStat;
  status: YoutubeStatsStatus | "loading";
  now?: Date;
  showAge?: boolean;
  className?: string;
}) {
  const text = statsLine(stat);
  if (!text) return null;
  const refreshed = status === "ok" || status === "loading";
  const age = agoLabel(stat.fetchedAt, now ?? new Date());
  const ageText = refreshed ? `updated ${age}` : `last fetched ${age}`;
  return (
    <p className={cn("text-[11px] text-[var(--muted-foreground)]", className)} title={`${text} - ${ageText}`}>
      <span className="font-medium text-white/80">{text}</span>
      {showAge ? <span> · {ageText}</span> : null}
    </p>
  );
}

/** A board card's numbers for one published YouTube post; nothing at all when there are none to show. */
export function YoutubeCardStats({ itemId, videoId }: { itemId: string; videoId: string }) {
  const { stats, status } = useYoutubeStats([{ itemId, videoId }]);
  const stat = stats[videoId];
  if (!stat) return null;
  return <YoutubeStatsLine stat={stat} status={status} showAge={false} className="mt-1 text-[10px]" />;
}
