import { CHANNEL_KEYWORDS } from "@/lib/clipping/keywords";

/**
 * The description + keywords a fresh clip/long-form project starts with, shown
 * in the "Description" dropdown under the title in both editors. The creator
 * can edit any project's copy freely; this is only the starting point so a new
 * project is never blank.
 *
 * Replace DEFAULT_VIDEO_DESCRIPTION with the channel's real boilerplate (links,
 * CTAs, socials) — it is intentionally in one place so it's a one-line swap.
 */
export const DEFAULT_VIDEO_DESCRIPTION = `Watch me build CoLateral — an AI-powered workspace for structural engineers — live, using AI coding tools like Claude and ChatGPT.

Every video is building in public: real vibe coding, real AI agents, real startup decisions. If you're into AI, coding, SaaS, and automation, subscribe and follow along.

🔗 Links
- Website: https://
- X / Twitter: https://
- Newsletter: https://`;

/**
 * The default keyword set, stored as a single comma-separated string so it maps
 * straight into the dropdown's editable input. Sourced from CHANNEL_KEYWORDS so
 * the description dropdown shares the same voice as generated titles/metadata.
 */
export const DEFAULT_VIDEO_KEYWORDS = CHANNEL_KEYWORDS.join(", ");
