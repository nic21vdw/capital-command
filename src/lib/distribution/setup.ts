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

/** What the Automations card says when it cannot see the scheduled task: that is a status, not a runner to name. */
const CANNOT_CHECK_RUNNER = /can't check the background runner/i;
const RUNNER_SUBJECT: Record<string, string> = { threads: "The Threads autopilot", podcast: "The podcast publisher" };

const SETTINGS = { href: "/settings", hrefLabel: "Settings" } as const;
const AUTOMATIONS = { href: "/automations", hrefLabel: "Automations" } as const;
/** Credentials and Media hosting live on the Accounts tab of Settings. */
const ACCOUNTS = { href: "/settings#accounts", hrefLabel: "Settings > Accounts" } as const;
const SAYS_ACCOUNTS = /Settings\s*(?:>|&gt;|→)\s*Accounts/i;

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
  const text = real[0].replace(/\s+/g, " ");
  // "Background runner" is the Automations page's word for a Windows task; here it reads as
  // jargon, so say what Nic cares about (is it running?) and link to where he can find out.
  if (CANNOT_CHECK_RUNNER.test(text)) {
    return { reason: `${RUNNER_SUBJECT[id] ?? "This automation"} isn't confirmed running`, ...AUTOMATIONS };
  }
  // A blocker that names Settings > Accounts as the fix (the Threads token, the podcast's Media
  // hosting) must LINK there: the line used to say "Settings > Accounts" and offer "Open Automations".
  // The problem is what comes before the dash; the link is the fix.
  if (SAYS_ACCOUNTS.test(text)) {
    const problem = text.split(/\s+[-\u2013\u2014]+\s+/)[0] ?? text;
    const fixless = SAYS_ACCOUNTS.test(problem) ? problem.replace(/\s*(?:Add|Put)[^.]*Settings[^.]*\.?$/i, "") : problem;
    return { reason: truncateAtWord(fixless.replace(/[.\s]+$/, ""), 110), ...ACCOUNTS };
  }
  // The first sentence is the problem; the rest is the fix, which the Automations card spells out.
  const first = (text.split(/(?<=\.)\s/)[0] ?? text).replace(/[.\s]+$/, "");
  return { reason: truncateAtWord(first, 110), ...AUTOMATIONS };
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
