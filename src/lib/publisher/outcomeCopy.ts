import { describeFailure } from "@/lib/publisher/failure";
import { dateTimeFormat } from "@/lib/publisher/intl";
import type { PlatformId } from "@/lib/publisher/types";

/**
 * What a run's outcome says in a toast, in words.
 *
 * The runner's outcome is a status word ("scheduled", "published", "uploaded")
 * and a log-style detail. Printed raw it said "YouTube: scheduled" in green
 * after Publish now - true to the queue, useless to the person who pressed
 * the button. This turns an outcome into what actually happened to the post,
 * and a failure into `describeFailure`'s sentence instead of the provider's
 * payload. Pure and client-safe (the board and its hook import it).
 */

const LABELS: Record<PlatformId, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook"
};

/**
 * The toast for a post booked onto a platform with no connected account. The
 * queue keeps it as a manual reminder - nothing will post by itself - so it is
 * said in amber and in those words, never as "Scheduled".
 */
export function manualReminderCopy(platform: PlatformId): string {
  return `Saved as a reminder - ${LABELS[platform] ?? platform} isn't connected. Connect it to post automatically.`;
}

export type RunOutcomeLike = { platform: string; outcome: string; detail: string };

export type OutcomeLine = {
  tone: "success" | "info" | "warning" | "error";
  text: string;
  /** The provider's own words, kept for a Details view; never the headline. */
  raw?: string;
};

/** "3:00 PM", or "Tue, Oct 14, 3:00 PM" when it is not the same day as `now`. */
export function formatGoLive(iso: string, timeZone?: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "its slot";
  const zone = timeZone ? { timeZone } : {};
  const day = (date: Date) => dateTimeFormat("en-CA", { ...zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  if (day(at) === day(now)) {
    return dateTimeFormat("en-US", { ...zone, hour: "numeric", minute: "2-digit" }).format(at);
  }
  return dateTimeFormat("en-US", {
    ...zone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(at);
}

export function describeRunOutcome(
  outcome: RunOutcomeLike,
  context: { publishAt: string; timeZone?: string; now?: Date }
): OutcomeLine {
  const platform = outcome.platform as PlatformId;
  const label = LABELS[platform] ?? outcome.platform;
  const detail = outcome.detail ?? "";
  const when = formatGoLive(context.publishAt, context.timeZone, context.now);

  switch (outcome.outcome) {
    case "published":
      if (platform === "youtube") {
        if (/private for review/i.test(detail)) {
          return { tone: "info", text: `${label}: uploaded private - long videos stay private until you publish them in Studio` };
        }
        return { tone: "success", text: `${label}: now public` };
      }
      return { tone: "success", text: `${label}: posted` };
    case "scheduled":
      if (platform === "youtube") {
        return { tone: "info", text: `${label}: already uploaded, goes live at ${when}` };
      }
      if (platform === "tiktok") {
        return { tone: "info", text: `${label}: in your TikTok inbox - open the TikTok app to finish the post` };
      }
      if (platform === "facebook") {
        return { tone: "info", text: `${label}: handed to Facebook, which publishes it at ${when}` };
      }
      return { tone: "info", text: `${label}: scheduled for ${when}` };
    case "uploaded":
      return { tone: "info", text: `${label}: uploaded and still processing - it finishes on the next run` };
    case "retrying":
      return { tone: "warning", text: `${label}: hit a snag - CoLateral Marketing will try again automatically`, raw: detail || undefined };
    case "deferred":
      return {
        tone: "warning",
        text: platform === "youtube"
          ? `${label}: today's upload limit is used up - it goes up after the quota resets`
          : `${label}: waiting - ${detail || "it goes up on the next run"}`,
        raw: detail || undefined
      };
    case "failed": {
      const advice = describeFailure({ status: "failed", attempts: 0, error: detail }, platform);
      // Most headlines already name the platform; the rest get it prefixed.
      const text = advice.headline.includes(label) ? advice.headline : `${label}: ${advice.headline}`;
      return { tone: "error", text, raw: advice.raw };
    }
    default:
      return { tone: "info", text: `${label}: ${outcome.outcome}` };
  }
}
