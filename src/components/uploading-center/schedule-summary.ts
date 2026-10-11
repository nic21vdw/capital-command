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

const MANUAL_DETAIL = "saved as a reminder - not connected. Connect it to post automatically.";

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
        ? `${manual} saved as ${manual === 1 ? "a reminder" : "reminders"}`
        : `Saved as ${manual === 1 ? "a reminder" : "reminders"} on ${manual} platform${manual === 1 ? "" : "s"}`
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

/** "America/Toronto" as a person says it: "Toronto time". UTC stays "UTC". */
export function zoneTimeLabel(timeZone: string): string {
  if (!timeZone.includes("/")) return timeZone;
  return `${(timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ")} time`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The days a batch landed on, as short as reads: "Mon", "Mon-Thu" within a week,
 * "Oct 12-Oct 20" beyond it. Days are the publish zone's, never the browser's.
 */
export function bookedDaysLabel(slotsUtc: string[], timeZone: string): string {
  const make = (zone: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric", year: "numeric" });
  let format: Intl.DateTimeFormat;
  try {
    format = make(timeZone);
  } catch {
    format = make("UTC");
  }
  const days = slotsUtc
    .map((utc) => new Date(utc))
    .filter((at) => !Number.isNaN(at.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())
    .map((at) => {
      const pick = Object.fromEntries(format.formatToParts(at).map((part) => [part.type, part.value]));
      return { weekday: pick.weekday, month: pick.month, day: pick.day, ordinal: Date.UTC(Number(pick.year), MONTHS.indexOf(pick.month), Number(pick.day)) };
    });
  if (days.length === 0) return "";
  const first = days[0];
  const last = days[days.length - 1];
  if (first.ordinal === last.ordinal) return first.weekday;
  if ((last.ordinal - first.ordinal) / 86_400_000 < 7) return `${first.weekday}-${last.weekday}`;
  return `${first.month} ${first.day}-${last.month} ${last.day}`;
}

/**
 * What Auto Assign says when it is done. Booked and "will actually post" are
 * different counts: a post for a platform with no connected account is saved
 * as a reminder, and a green "Auto-assigned 3 posts" over three of those is how
 * nobody found out until the slot passed. So the two are said apart: "4 booked:
 * Mon-Thu" for what will post, "4 saved as reminders - YouTube isn't connected.
 * Connect it to post automatically." for what will not, amber, and both when
 * a batch is mixed.
 */
export function summarizeAutoAssign(input: {
  /** Requests accepted by the queue (reminders included). */
  scheduled: number;
  /** Of those, how many are only reminders. */
  manual: number;
  /** Requests attempted. */
  total: number;
  /** Platforms the reminders are for, e.g. ["TikTok"]. */
  manualPlatforms: string[];
  firstError: string | null;
  /** Already-worded note about clips deliberately left out; starts with a space. */
  held: string;
  /** The slots (UTC) of the posts that WILL post, for "Mon-Thu". */
  bookedSlots?: string[];
  timeZone?: string;
  /**
   * A sentence that must stay with the booking until dismissed (the no-AI-key
   * notice). Only said when something was booked, and it makes a green summary
   * amber: the posts are fine, but there is something to read.
   */
  note?: string;
}): { level: "success" | "warning" | "error"; message: string } {
  const result = summarizeBooking(input);
  const note = input.note?.trim();
  if (!note || input.scheduled === 0) return result;
  return {
    level: result.level === "success" ? "warning" : result.level,
    message: `${result.message}${/[.!?]$/.test(result.message) ? "" : "."} ${note}`
  };
}

/** What Auto Assign says when the captions are the clip titles because no AI key answered. */
export const NO_AI_CAPTION_SUMMARY_NOTE =
  "Captions are the clip titles (no AI key) - edit them from each post's Caption button.";

function summarizeBooking(input: Parameters<typeof summarizeAutoAssign>[0]): {
  level: "success" | "warning" | "error";
  message: string;
} {
  const { scheduled, manual, total, manualPlatforms, firstError, held, bookedSlots = [], timeZone = "UTC" } = input;
  const automatic = scheduled - manual;
  const names = [...new Set(manualPlatforms)];
  const nameList = names.length === 0 ? "an unconnected platform" : names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const days = bookedDaysLabel(bookedSlots, timeZone);
  const booked = `${automatic} booked${days ? `: ${days}` : ""}`;
  const reminders = `${manual} saved as ${manual === 1 ? "a reminder" : "reminders"} - ${nameList} ${
    names.length > 1 ? "aren't" : "isn't"
  } connected. Connect ${names.length > 1 ? "them" : "it"} to post automatically.`;
  if (scheduled === 0) {
    return { level: "error", message: `${firstError ?? "Auto assign failed."}${held}` };
  }
  const tail = scheduled < total ? ` ${total - scheduled} not booked${firstError ? ` - ${firstError.replace(/[.\s]+$/, "")}` : ""}.` : "";
  if (automatic === 0) {
    // Everything that was booked is a reminder.
    return { level: "warning", message: `${reminders}${tail}${held}` };
  }
  if (manual > 0) {
    return { level: "warning", message: `${booked}. ${reminders}${tail}${held}` };
  }
  if (scheduled < total) {
    return { level: "warning", message: `${booked}.${tail}${held}` };
  }
  if (held) return { level: "warning", message: `${booked}.${held}` };
  return { level: "success", message: booked };
}
