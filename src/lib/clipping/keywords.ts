/**
 * The channel's shared metadata vocabulary — recurring keywords and the title
 * voice. Kept in its own dependency-free module (no AI SDK, no node built-ins)
 * so it is safe to import from client components (e.g. the Clip Editor's
 * description tooling) as well as the server-side generators. titles.ts and the
 * other metadata generators re-use these; see CLAUDE.md for the convention.
 */

/**
 * The named things the channel is actually about — products, models and the
 * software they replace. Kept apart from the broad topics below because a
 * title that names one of these is concrete ("Why I Use Opus 5 Despite the
 * Cost") where a title that only says "AI" is not; the title quality gate
 * scores on that difference.
 */
export const CHANNEL_ENTITIES = [
  "Claude",
  "Opus",
  "Sonnet",
  "Fable",
  "ChatGPT",
  "Grok",
  "Gemini",
  "Cursor",
  "CoLateral",
  "AutoCAD",
  "Revit",
  "OBS",
  "YouTube"
];

/** Recurring channel topics woven into titles/descriptions/tags when the clip supports them. */
export const CHANNEL_KEYWORDS = [
  "AI",
  "vibe coding",
  ...CHANNEL_ENTITIES,
  "AI agents",
  "coding",
  "SaaS",
  "startup",
  "business",
  "building in public",
  "engineering",
  "automation"
];

/** Example titles that define the channel's title voice. */
export const TITLE_STYLE_EXAMPLES = [
  "Vibe Coding a SaaS With Claude in 30 Minutes",
  "This AI Coding Trick Saves Me Hours Every Week",
  "Why I Let AI Write All My Code",
  "ChatGPT vs Claude for Real Business Work",
  "Building a Startup Live With AI Agents",
  "The AI Mistake Every New Founder Makes",
  "I Made AI Build My Entire Landing Page",
  "How Vibe Coding Changed My Engineering Business"
];
