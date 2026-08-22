// The "Yapping Until I Can Buy a Nicer Car" series is ALREADY a long-form
// video on the channel. An edit of it booked back to YouTube spends a daily
// upload slot to duplicate what is already there — 17 of them were booked and
// had to be pulled by hand on 2026-08-20, and the pipeline makes more every
// time a car yap is run through it. The Instagram vertical cut of one is a
// different thing and is wanted; only the YouTube long-form booking is not.

const CAR_YAP_TITLE = /Yapping\s+Until\s+I\s+Can\s+Buy\s+a\s+Nicer\s+Car/i;

export function isCarYapTitle(title: string | undefined | null): boolean {
  return CAR_YAP_TITLE.test(title ?? "");
}

export const CAR_YAP_YOUTUBE_NOTE =
  "This is a car yap, and the car yap is already on YouTube — re-uploading an edit of it spends a daily upload slot to duplicate the channel. The vertical cut for Instagram is the one worth posting.";
