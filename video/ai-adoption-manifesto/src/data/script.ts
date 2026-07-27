/**
 * script.ts — The complete manifesto. One entry per slide.
 *
 * `headline`   → the on-screen copy the animation renders.
 * `kicker`     → optional small label above the headline.
 * `narration`  → the exact words you speak over the slide (your teleprompter).
 * `accent`     → which Dracula accent token drives the slide's glow.
 *
 * Edit copy here; the slide components read from this file, so wording never
 * needs to be touched inside the animation logic.
 */
import type { AccentKey } from "../config";

export interface SlideCopy {
  id: string;
  act: string;
  kicker?: string;
  headline: string;
  accent: AccentKey;
  narration: string;
}

export const SCRIPT: Record<string, SlideCopy> = {
  slide01Hook: {
    id: "01",
    act: "ACT I — THE RESISTANCE",
    kicker: "",
    headline: "2026.",
    accent: "accent",
    narration:
      "In 1995, people laughed at the internet. I'm a structural engineer — and I built a software company mostly alone. Ten years ago that sentence was impossible. Today it's just the beginning.",
  },
  slide02Split: {
    id: "02",
    act: "ACT I — THE RESISTANCE",
    kicker: "IT FEELS LIKE",
    headline: "The whole world is turning away.",
    accent: "accent",
    narration:
      "Right now it feels like almost everyone despises this tool. They boo it off the stage. They fear it. And I understand why — but they are standing on the wrong side of history.",
  },
  slide03Fear: {
    id: "03",
    act: "ACT I — THE RESISTANCE",
    kicker: "THE FEAR",
    headline: "“It's going to take our jobs.”",
    accent: "muted" as AccentKey,
    narration:
      "The fear is real, and I won't dismiss it. ‘It's going to take our jobs.’ I hear it every single day. So let's actually talk about it — honestly.",
  },
  slide04Reframe: {
    id: "04",
    act: "ACT I — THE RESISTANCE",
    kicker: "THE TRUTH",
    headline: "It doesn't erase work.\nIt rewrites it.",
    accent: "accentAlt",
    narration:
      "AI doesn't erase work — it rewrites it. It takes the job you have today and rebuilds it into the job you'll actually want tomorrow.",
  },
  slide05Internet: {
    id: "05",
    act: "ACT II — THE PRECEDENT",
    kicker: "REMEMBER THIS",
    headline: "None of these jobs existed\nbefore the internet.",
    accent: "line",
    narration:
      "Social media manager. Cloud architect. App developer. Data scientist. None of these jobs existed before the internet. An entire economy was built on top of a thing people once laughed at.",
  },
  slide06Claim: {
    id: "06",
    act: "ACT II — THE PRECEDENT",
    kicker: "THE CLAIM",
    headline: "AI does the same.\nOnly faster.",
    accent: "accent",
    narration:
      "AI does exactly the same thing — only faster. The jobs of the next decade are being defined right now, while most people are still arguing about whether to look.",
  },
  slide07Faster: {
    id: "07",
    act: "ACT II — THE PRECEDENT",
    kicker: "THE CONSEQUENCE",
    headline: "The world is about to move\nfaster than ever.",
    accent: "accentAlt",
    narration:
      "And so the world speeds up. It's already fast — it's about to become relentless. The distance between the people who adapt and the people who wait widens every single month.",
  },
  slide08Choice: {
    id: "08",
    act: "ACT II — THE PRECEDENT",
    kicker: "THE CHOICE",
    headline: "You're compounding —\nor you're falling behind.",
    accent: "growth",
    narration:
      "There is no neutral position anymore. Every month you're either compounding, or you're falling behind. Standing still is now a decision — and it's the wrong one.",
  },
  slide09Pivot: {
    id: "09",
    act: "ACT III — THE EMPIRE",
    kicker: "SO HERE'S WHY",
    headline: "I'm not here to just consult.",
    accent: "accent",
    narration:
      "So this is why I'm not here to simply run a business. Not here to simply be a structural engineering consultant. That was never the ceiling.",
  },
  slide10OnePerson: {
    id: "10",
    act: "ACT III — THE EMPIRE",
    kicker: "THE UNLOCK",
    headline: "One person can now build\nwhat once took hundreds.",
    accent: "accentAlt",
    narration:
      "One individual can now build what used to take a company of hundreds. I want to build something people today couldn't fathom being done by a single person.",
  },
  slide11Colateral: {
    id: "11",
    act: "ACT III — THE EMPIRE",
    kicker: "PROOF OF INTENT",
    headline: "CoLateral is product one.\nNot the last.",
    accent: "accent",
    narration:
      "CoLateral is product one — built on Fable 5. It is the first tool, not the last. We start with one piece of collateral, and we compound from there.",
  },
  slide12Enterprise: {
    id: "12",
    act: "ACT III — THE EMPIRE",
    kicker: "THE VISION",
    headline: "An enterprise of tools.\nA brand that outlives the noise.",
    accent: "line",
    narration:
      "Eventually, an entire enterprise of tools. An empire of a personal brand — something people will recognize for many, many years to come.",
  },
  slide13Philosophy: {
    id: "13",
    act: "ACT III — THE EMPIRE",
    kicker: "THE PHILOSOPHY",
    headline: "Start slow. Start early.\nCompound relentlessly.",
    accent: "growth",
    narration:
      "So we start slow. We start early. One thing at a time. Empires are not launched — they are compounded, patiently, while everyone else waits for permission.",
  },
  slide14Close: {
    id: "14",
    act: "ACT III — THE EMPIRE",
    kicker: "",
    headline: "We're not building a business.\nWe're building an empire.",
    accent: "accentAlt",
    narration:
      "We're not here to build a business. We're here to build an empire — something people can't yet imagine one person could build. This is what we're building toward. Let's go.",
  },
};

/** Ordered list of slide keys — drives the FullVideo sequence. */
export const SLIDE_ORDER = [
  "slide01Hook",
  "slide02Split",
  "slide03Fear",
  "slide04Reframe",
  "slide05Internet",
  "slide06Claim",
  "slide07Faster",
  "slide08Choice",
  "slide09Pivot",
  "slide10OnePerson",
  "slide11Colateral",
  "slide12Enterprise",
  "slide13Philosophy",
  "slide14Close",
] as const;
