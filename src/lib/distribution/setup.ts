import { truncateAtWord } from "@/lib/automations/format";
import type { AutomationCard } from "@/lib/automations/types";

/**
 * Whether a format the Distribution Centre calls "Automatic" can really post by
 * itself right now. The tag describes what the code does when everything is
 * connected; it said nothing about the day it is not, so a format with no
 * account behind it still read as "Automatic" in green.
 */
export type SetupNeed = {
  /** One plain clause: what is missing. */
  reason: string;
  /** Where the fix lives: Settings for a connection, Automations for a blocked runner. */
  href: string;
  hrefLabel: string;
};

export type SetupInputs = {
  /** Platforms with credentials, from the studio overview. */
  configuredPlatforms: string[];
  /** Whether publishing is switched on at all. */
  publishEnabled: boolean;
  /** The Automations cards, when they could be read; absent means unknown, never "blocked". */
  cards?: AutomationCard[] | null;
};

type OutputKey = "longform" | "shorts" | "audio" | "x" | "threads" | "text" | "carousel";

const LABELS: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" };

/** The page can't see the Windows task from a sandbox or another checkout: that is not the owner's to fix. */
const ENVIRONMENT_BLOCKER = /can't read the Windows task|different checkout/i;

const SETTINGS = { href: "/settings", hrefLabel: "Settings" } as const;
const AUTOMATIONS = { href: "/automations", hrefLabel: "Automations" } as const;

function names(ids: string[]): string {
  const labels = ids.map((id) => LABELS[id] ?? id);
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}` : (labels[0] ?? "");
}

function missing(platforms: string[], inputs: SetupInputs): SetupNeed | null {
  const absent = platforms.filter((id) => !inputs.configuredPlatforms.includes(id));
  if (absent.length === 0) return null;
  return { reason: `${names(absent)} ${absent.length > 1 ? "aren't" : "isn't"} connected`, ...SETTINGS };
}

function blockedCard(id: AutomationCard["id"], inputs: SetupInputs): SetupNeed | null {
  const card = inputs.cards?.find((entry) => entry.id === id);
  if (!card || card.paused) return null;
  const real = card.blockers.filter((blocker) => !ENVIRONMENT_BLOCKER.test(blocker));
  if (real.length === 0) return null;
  // The first sentence is the problem; the rest is the fix, which the Automations card spells out.
  const first = (real[0].replace(/\s+/g, " ").split(/(?<=\.)\s/)[0] ?? real[0]).replace(/[.\s]+$/, "");
  const clause = truncateAtWord(first, 110);
  return { reason: clause, ...AUTOMATIONS };
}

/** Null when the format's automatic posting has what it needs (or nothing is known to be missing). */
export function setupNeed(output: OutputKey, inputs: SetupInputs): SetupNeed | null {
  const sharedPublisher = ["longform", "shorts", "carousel"].includes(output);
  if (sharedPublisher && !inputs.publishEnabled) {
    return { reason: "posting is switched off", ...SETTINGS };
  }
  switch (output) {
    case "longform":
      return missing(["youtube"], inputs);
    case "shorts":
      return missing(["youtube", "instagram", "facebook"], inputs);
    case "carousel":
      return missing(["instagram", "facebook"], inputs);
    case "audio":
      return blockedCard("podcast", inputs);
    case "text":
      return blockedCard("threads", inputs);
    default:
      return null;
  }
}
