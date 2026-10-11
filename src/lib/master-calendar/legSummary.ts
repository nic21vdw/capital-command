import {
  eventStatusLabel,
  isAwaitingConnectionEventStatus,
  isLateEventStatus,
  type MasterCalendarEvent
} from "@/lib/master-calendar/types";

/**
 * What a post says about itself when its platforms disagree.
 *
 * A post is ONE roll-up status ("needs connection") over several legs, and when
 * the legs differ the chip read as if it were about all of them while the line
 * beside it spoke about one ("Needs connection" next to "YouTube: its slot
 * passed, so it should be live"). So when the legs are not all in the same
 * place the chip says "Mixed" and the platforms are told apart underneath, one
 * line per state, in the Uploading Center's words. A post whose legs agree
 * keeps its single chip exactly as before.
 *
 * Pure: the screens only choose how to draw what comes back, and the tooltip,
 * the day card and the calendar row cannot word the same post three ways.
 */

export type LegGroupKind =
  | "failed"
  | "needsConnection"
  | "overdue"
  | "shouldBeLive"
  | "manual"
  | "published"
  | "scheduled"
  | "queued";

/** The link a line offers, if any; the screen knows where each one goes. */
export type LegLineAction = "connect" | "check" | "automations";

export type LegGroupLine = {
  kind: LegGroupKind;
  /** The platforms in this state, in the post's own order. */
  platforms: string[];
  /** True for states that need a look; the quiet ones (published, scheduled, queued) are false. */
  attention: boolean;
  /** Before its slot (only meaningful for needsConnection): the connection is still in time. */
  upcoming: boolean;
  /** The brief phrase for a headline: "Instagram, Facebook need connection". */
  short: string;
  /** The full sentence under the chip. */
  text: string;
  action?: LegLineAction;
};

export type EventStatusSummary = {
  /** More than one state across the legs of a post that needs a look. */
  mixed: boolean;
  /** What the chip says: "Mixed" for a mixed post, else the usual roll-up label. */
  label: string;
  /** Every state in one line - "YouTube should be live · Instagram, Facebook need connection" - for tooltips and screen readers. */
  headline: string;
  /** One line per state, in the order the platforms appear on the post. */
  lines: LegGroupLine[];
};

export const MIXED_LABEL = "Mixed";

const ATTENTION = new Set<LegGroupKind>(["failed", "needsConnection", "overdue", "shouldBeLive", "manual"]);

type Leg = NonNullable<MasterCalendarEvent["legs"]>[number];

function kindOfLeg(leg: Leg): LegGroupKind {
  if (leg.status === "failed") return "failed";
  if (leg.late === "needs-connection" || leg.awaitingConnection) return "needsConnection";
  if (leg.late === "overdue") return "overdue";
  if (leg.late === "should-be-live") return "shouldBeLive";
  if (leg.status === "published") return "published";
  if (leg.status === "manual") return "manual";
  if (leg.status === "scheduled" || leg.status === "uploaded") return "scheduled";
  return "queued";
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function describe(kind: LegGroupKind, platforms: string[], upcoming: boolean, when?: string): Pick<LegGroupLine, "short" | "text" | "action"> {
  const list = platforms.join(", ");
  const names = joinNames(platforms);
  const many = platforms.length > 1;
  const isAre = many ? "are" : "is";
  switch (kind) {
    case "failed":
      return { short: `${list} failed`, text: `${names} failed.` };
    case "needsConnection":
      return {
        short: `${list} ${many ? "need" : "needs"} connection`,
        text: upcoming
          ? `Connect ${names} before ${when ?? "its slot"} to post automatically, or post it by hand.`
          : `${names} ${isAre} not connected and the slot passed, so nothing could be sent.`,
        action: "connect"
      };
    case "overdue":
      return { short: `${list} ${isAre} overdue`, text: `${names}: its slot passed and the publisher has not sent it.`, action: "automations" };
    case "shouldBeLive":
      return { short: `${list} should be live`, text: `${names}: its slot passed, so it should be live.`, action: "check" };
    case "manual":
      return { short: `${list} to post by hand`, text: `${names}: post it by hand.` };
    case "published":
      return { short: `${list} ${isAre} live`, text: `${names} ${isAre} live.` };
    case "scheduled":
      return { short: `${list} ${isAre} scheduled`, text: `${names} ${isAre} scheduled.` };
    case "queued":
      return { short: `${list} ${isAre} queued`, text: `${names} ${isAre} queued.` };
  }
}

/**
 * The legs of a post grouped by where they stand, one line each. `when` is how
 * the slot reads in the sentence about a connection still in time ("15:00",
 * "Tue, Oct 14, 15:00"); absent, the event's own time is used.
 */
export function legLines(event: Pick<MasterCalendarEvent, "legs" | "time">, when?: string): LegGroupLine[] {
  const groups = new Map<LegGroupKind, { platforms: string[]; upcoming: boolean }>();
  for (const leg of event.legs ?? []) {
    const kind = kindOfLeg(leg);
    const group = groups.get(kind) ?? { platforms: [], upcoming: false };
    if (!group.platforms.includes(leg.platform)) group.platforms.push(leg.platform);
    if (leg.awaitingConnection) group.upcoming = true;
    groups.set(kind, group);
  }
  // In the post's own platform order (a Map keeps first-seen order), so the line
  // reads the way the platforms are listed everywhere else.
  return [...groups].map(([kind, { platforms, upcoming }]) => {
    return { kind, platforms, upcoming, attention: ATTENTION.has(kind), ...describe(kind, platforms, upcoming, when ?? event.time) };
  });
}

/** Whether a roll-up status is one of the ones that needs a look about timing or a connection. */
function needsALook(status: string): boolean {
  return isLateEventStatus(status) || isAwaitingConnectionEventStatus(status);
}

export function summarizeEventStatus(event: MasterCalendarEvent, options: { when?: string } = {}): EventStatusSummary {
  const lines = legLines(event, options.when);
  const mixed = needsALook(event.status) && lines.length > 1;
  return {
    mixed,
    label: mixed ? MIXED_LABEL : eventStatusLabel(event.status, event),
    headline: lines.map((line) => line.short).join(" · "),
    lines
  };
}
