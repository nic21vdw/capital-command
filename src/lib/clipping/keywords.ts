/**
 * The channel's shared metadata vocabulary — recurring keywords and the title
 * voice. Kept in its own dependency-free module (no AI SDK, no node built-ins)
 * so it is safe to import from client components (e.g. the Clip Editor's
 * description tooling) as well as the server-side generators. titles.ts and the
 * other metadata generators re-use these; see CLAUDE.md for the convention.
 */

/** Recurring channel topics woven into titles/descriptions/tags when the clip supports them. */
export const CHANNEL_KEYWORDS = [
  "AI",
  "vibe coding",
  "Claude",
  "Codex",
  "ChatGPT",
  "AI agents",
  "agentic workspace",
  "project canvas",
  "coding",
  "SaaS",
  "startup",
  "business",
  "building in public",
  "engineering",
  "automation"
];

export const COLATERAL_DESCRIPTION =
  "CoLateral is a desktop agentic workspace for developers, creators and engineers, where AI agents, files and ideas share one project canvas.";

export const CHANNEL_CONTEXT =
  `The creator is Nic Vandewetering, founder and builder of CoLateral. ${COLATERAL_DESCRIPTION} He builds it live with Claude Code, Codex and other AI tools, sharing the real product work, experiments, mistakes and business decisions along the way.`;

/** Example titles that define the channel's title voice. */
export const TITLE_STYLE_EXAMPLES = [
  "Vibe Coding a SaaS With Claude in 30 Minutes",
  "This AI Coding Trick Saves Me Hours Every Week",
  "Why I Let AI Write All My Code",
  "ChatGPT vs Claude for Real Business Work",
  "Building a Startup Live With AI Agents",
  "The AI Mistake Every New Founder Makes",
  "I Made AI Build My Entire Landing Page",
  "I Put My AI Agents and Files on One Canvas"
];
