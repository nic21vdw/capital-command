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

const MANUAL_DETAIL = "saved as a manual reminder - connect it in Settings to post automatically.";

/** Whether the booked post's leg for this platform is only a reminder to post by hand. */
export function isManualLeg(item: Pick<QueueItem, "platforms"> | undefined, platform: PlatformId): boolean {
  return item?.platforms[platform]?.status === "manual";
}

export type RunOutcome = { platform: string; outcome: string; detail: string };

export type PlatformResult = {
  platform: PlatformId;
  booked: boolean;
  /** How the line should read: green, yellow (needs a look) or red. */
  level: "success" | "warning" | "error";
  /** The rest of the line after the platform name. */
  detail: string;
  /**
   * Booked, but as a reminder to post by hand: the account isn't connected, so
   * nothing will go out on its own. Counted apart from the posts that will.
   */
  manual?: boolean;
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
  if (isManualLeg(item, platform)) {
    return { platform, booked: true, level: "warning", manual: true, detail: MANUAL_DETAIL };
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
  const manual = platformCount(results.filter((result) => result.booked && result.manual));
  if (manual > 0 && booked > 0) {
    // Booked is not the same as will post: say how many of each.
    const automatic = booked - manual;
    const parts: string[] = [];
    if (automatic > 0) parts.push(`Scheduled on ${automatic} platform${automatic === 1 ? "" : "s"}`);
    parts.push(
      automatic > 0
        ? `${manual} saved as ${manual === 1 ? "a manual reminder" : "manual reminders"}`
        : `Saved as ${manual === 1 ? "a manual reminder" : "manual reminders"} on ${manual} platform${manual === 1 ? "" : "s"}`
    );
    if (booked < total) parts.push(`${total - booked} not booked`);
    return {
      level: results.some((result) => result.level === "error") ? "error" : "warning",
      title: `${parts.join(", ")}${pairNote}`,
      lines
    };
  }
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

/**
 * What Auto Assign says when it is done. Booked and "will actually post" are
 * different counts: a post for a platform with no connected account is saved
 * as a manual reminder, and a green "Auto-assigned 3 posts" over three of
 * those is how nobody found out until the slot passed.
 */
export function summarizeAutoAssign(input: {
  /** Requests accepted by the queue (manual reminders included). */
  scheduled: number;
  /** Of those, how many are only manual reminders. */
  manual: number;
  /** Requests attempted. */
  total: number;
  /** Platforms the manual reminders are for, e.g. ["TikTok"]. */
  manualPlatforms: string[];
  firstError: string | null;
  /** Already-worded note about clips deliberately left out; starts with a space. */
  held: string;
}): { level: "success" | "warning" | "error"; message: string } {
  const { scheduled, manual, total, manualPlatforms, firstError, held } = input;
  const posts = (count: number) => `${count} post${count === 1 ? "" : "s"}`;
  const automatic = scheduled - manual;
  const names = [...new Set(manualPlatforms)].join(" and ") || "an unconnected platform";
  const manualNote =
    manual > 0
      ? automatic > 0
        ? ` ${posts(manual)} saved as ${manual === 1 ? "a manual reminder" : "manual reminders"} for ${names} - connect it in Settings to post automatically.`
        : ""
      : "";
  if (scheduled === 0) {
    return { level: "error", message: `${firstError ?? "Auto assign failed."}${held}` };
  }
  if (automatic === 0) {
    // Everything that was booked is a reminder.
    const tail = scheduled < total ? ` ${total - scheduled} not booked${firstError ? ` - ${firstError}` : "."}` : "";
    return {
      level: "warning",
      message: `Saved ${posts(manual)} as ${manual === 1 ? "a manual reminder" : "manual reminders"} for ${names} - connect it in Settings to post automatically.${tail}${held}`
    };
  }
  if (scheduled < total) {
    return {
      level: "warning",
      message: `Auto-assigned ${automatic} of ${total} posts${firstError ? ` - ${firstError}` : "."}${manualNote}${held}`
    };
  }
  if (manual > 0 || held) {
    return {
      level: "warning",
      message: `Auto-assigned ${posts(automatic)} to the next open slots.${manualNote}${held}`
    };
  }
  return { level: "success", message: `Auto-assigned ${posts(automatic)} to the next open slots.` };
}
