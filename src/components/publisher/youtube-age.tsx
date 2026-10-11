"use client";

import Link from "next/link";
import { CONNECT_TO_REFRESH, statsAgeParts, type YoutubeStatsStatus } from "@/lib/publisher/youtubeStatsShared";

/** "Updated 12 min ago", or "Numbers from 2 days ago - connect YouTube to refresh" with the last half a link to Settings. */
export function YoutubeAge({ status, fetchedAt, now }: { status: YoutubeStatsStatus | "loading"; fetchedAt: string; now?: Date }) {
  const { text, connect } = statsAgeParts(status, fetchedAt, now ?? new Date());
  return (
    <>
      {text}
      {connect ? (
        <>
          {" - "}
          <Link href="/settings#accounts" className="text-[var(--accent)] hover:underline">
            {CONNECT_TO_REFRESH}
          </Link>
        </>
      ) : null}
    </>
  );
}
