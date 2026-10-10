import type { PlatformId } from "@/lib/publisher/types";

/**
 * What /api/publish/overview says beyond the quota meter and the slot times:
 * the shorts-a-day cap, the YouTube mirror, and whether the publisher itself is
 * paused or installed. Types and wording only, with no Node imports, because the
 * Uploading Center (a client component) imports them to draw its banners.
 */

export type PublishMirrorOverview = {
  enabled: boolean;
  /** The platform whose schedule the others copy. */
  lead: PlatformId;
  targets: PlatformId[];
};

/** The Windows task that runs the publisher, as far as it could be checked. */
export type PublisherTaskOverview = {
  state: "ready" | "running" | "disabled" | "missing" | "other-checkout" | "unknown";
  lastRunAt: string | null;
  nextRunAt: string | null;
};

export type PublisherAutomationOverview = {
  /** The Automations page's pause switch for the publisher. */
  paused: boolean;
  task: PublisherTaskOverview;
};

/** How long without a run before a registered runner stops reading as healthy. */
export const PUBLISHER_STALE_MINUTES = 120;

export type PublisherBannerLine = {
  tone: "warning" | "muted";
  text: string;
  href?: string;
  linkLabel?: string;
};

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function agoLabel(thenMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - thenMs) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * The one line the Uploading Center shows about the publisher, or null when
 * there is nothing worth saying (the runner state could not be checked). A
 * healthy, recent runner gets a muted line, not a banner.
 */
export function publisherBannerLine(
  automation: PublisherAutomationOverview | undefined,
  now: Date
): PublisherBannerLine | null {
  if (!automation) return null;
  if (automation.paused) {
    return {
      tone: "warning",
      text: "Publisher paused - nothing is sent from the schedule until you resume it.",
      href: "/automations",
      linkLabel: "Open Automations"
    };
  }
  const { task } = automation;
  if (task.state === "missing") {
    return {
      tone: "warning",
      text: "Publisher runner not installed - run npm run publish:register in the app folder."
    };
  }
  if (task.state === "disabled") {
    return {
      tone: "warning",
      text: "Publisher runner is disabled in Windows Task Scheduler, so scheduled posts are not sent.",
      href: "/automations",
      linkLabel: "Open Automations"
    };
  }
  if (task.state === "other-checkout") {
    return { tone: "muted", text: "The publisher runner is registered for a different app folder than this one." };
  }
  if (task.state === "unknown") return null;
  if (!task.lastRunAt) return { tone: "muted", text: "Publisher runner is installed but has not run yet." };
  const lastMs = new Date(task.lastRunAt).getTime();
  if (!Number.isFinite(lastMs)) return null;
  const stale = now.getTime() - lastMs > PUBLISHER_STALE_MINUTES * 60_000;
  const text = `Publisher last ran ${agoLabel(lastMs, now.getTime())}.`;
  return stale
    ? { tone: "warning", text: `${text} It should run every few minutes.`, href: "/automations", linkLabel: "Open Automations" }
    : { tone: "muted", text };
}

/** "YouTube (also mirrored to Instagram and Facebook)", or null when nothing mirrors. */
export function mirroredNote(
  mirror: PublishMirrorOverview | undefined,
  names: Record<PlatformId, string>
): string | null {
  if (!mirror?.enabled) return null;
  const targets = mirror.targets.filter((platform) => platform !== mirror.lead);
  if (targets.length === 0) return null;
  const list = targets.map((platform) => names[platform]);
  const joined = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0];
  return `${names[mirror.lead]} (also mirrored to ${joined})`;
}
