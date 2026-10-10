import type { PlatformId, QueueItem } from "@/lib/publisher/types";

/**
 * What "Schedule everywhere" says when it is done: one toast with a line per
 * platform, instead of "Scheduled on all 3 platforms" over four platforms or
 * "2 of 3" plus whichever error came first. Pure, so the wording is tested.
 *
 * Instagram carries Facebook with it (one queue item, both platforms), so the
 * two read as one line - "Instagram and Facebook as one post" - and count as
 * two platforms.
 */

export type RunOutcome = { platform: string; outcome: string; detail: string };

export type PlatformResult = {
  platform: PlatformId;
  booked: boolean;
  /** How the line should read: green, yellow (needs a look) or red. */
  level: "success" | "warning" | "error";
  /** The rest of the line after the platform name. */
  detail: string;
};

const NAMES: Record<PlatformId, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook"
};

/** The result for a request the server refused (nothing was booked). */
export function refusedResult(platform: PlatformId, error: string): PlatformResult {
  return { platform, booked: false, level: "error", detail: `not booked - ${error.replace(/[.\s]+$/, "")}.` };
}

/** The result for a booked post, from the immediate run the server did for it. */
export function bookedResult(
  platform: PlatformId,
  item: Pick<QueueItem, "platforms"> | undefined,
  outcome: RunOutcome | undefined
): PlatformResult {
  const detail = outcome?.detail?.trim();
  if (outcome?.outcome === "failed") {
    return {
      platform,
      booked: true,
      level: "error",
      detail: `booked, but the upload failed${detail ? ` - ${detail.replace(/[.\s]+$/, "")}` : ""}.`
    };
  }
  if (outcome?.outcome === "retrying") {
    return { platform, booked: true, level: "warning", detail: "booked; the upload was interrupted and will retry on its own." };
  }
  if (outcome?.outcome === "published") return { platform, booked: true, level: "success", detail: "published." };
  if (outcome?.outcome === "scheduled") {
    return {
      platform,
      booked: true,
      level: "success",
      detail: platform === "youtube" ? "uploaded and scheduled on your channel." : "scheduled."
    };
  }
  if (item?.platforms[platform]?.status === "manual") {
    return {
      platform,
      booked: true,
      level: "warning",
      detail: "saved as a reminder to post by hand - this account isn't connected yet."
    };
  }
  return { platform, booked: true, level: "success", detail: "scheduled." };
}

function label(platform: PlatformId, paired: boolean): string {
  return platform === "instagram" && paired ? "Instagram and Facebook (one post)" : NAMES[platform];
}

/** How many platforms a result list covers, Instagram counting for Facebook too. */
function platformCount(results: PlatformResult[]): number {
  return results.reduce((sum, result) => sum + (result.platform === "instagram" ? 2 : 1), 0);
}

export function summarizeSchedule(results: PlatformResult[]): {
  level: "success" | "warning" | "error";
  title: string;
  lines: string[];
} {
  const total = platformCount(results);
  const booked = platformCount(results.filter((result) => result.booked));
  const paired = results.some((result) => result.platform === "instagram");
  const pairNote = paired ? " (Instagram and Facebook as one post)" : "";
  const lines = results.map((result) => `${label(result.platform, true)}: ${result.detail}`);
  if (booked === 0) {
    return { level: "error", title: `Nothing was scheduled on ${total} platforms${pairNote}`, lines };
  }
  const allGood = booked === total && results.every((result) => result.level === "success");
  if (booked === total) {
    return {
      level: allGood ? "success" : results.some((result) => result.level === "error") ? "error" : "warning",
      title: `Scheduled on ${total} platforms${pairNote}`,
      lines
    };
  }
  return { level: "warning", title: `Scheduled on ${booked} of ${total} platforms${pairNote}`, lines };
}
