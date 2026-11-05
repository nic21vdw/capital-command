import { OWNER_IDENTITY } from "@/lib/brand/owner-identity";

// One of the channel's recurring series (OWNER_IDENTITY.alreadyOnYoutubeSeries)
// is ALREADY a long-form video on the channel. An edit of it booked back to
// YouTube spends a daily upload slot to duplicate what is already there: 17 were
// booked and pulled by hand on 2026-08-20. The Instagram vertical cut of one is
// a different thing and is wanted; only the YouTube long-form booking is not.

export function isCarYapTitle(title: string | undefined | null): boolean {
  return OWNER_IDENTITY.alreadyOnYoutubeSeries.some((series) => series.test(title ?? ""));
}

export const CAR_YAP_YOUTUBE_NOTE =
  "This is a car yap, and the car yap is already on YouTube — re-uploading an edit of it spends a daily upload slot to duplicate the channel. The vertical cut for Instagram is the one worth posting.";
