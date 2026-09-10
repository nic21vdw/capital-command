import { CHANNEL_KEYWORDS, COLATERAL_DESCRIPTION } from "@/lib/clipping/keywords";

/**
 * The description + keywords a fresh clip/long-form project starts with, shown
 * in the "Description" dropdown under the title in both editors. The creator
 * can edit any project's copy freely; this is only the starting point so a new
 * project is never blank.
 *
 * Replace DEFAULT_VIDEO_DESCRIPTION with the channel's real boilerplate (links,
 * CTAs, socials) — it is intentionally in one place so it's a one-line swap.
 */
export const DEFAULT_VIDEO_DESCRIPTION = `I'm building CoLateral in public. ${COLATERAL_DESCRIPTION}

These videos show the real work behind it: new features, AI workflows, experiments, mistakes and the decisions that go into shipping software with Claude Code, Codex and other AI tools.

Explore CoLateral: https://colateralai.com
Watch the full build: https://www.youtube.com/@nicvandewetering
Follow updates: https://x.com/nic21vdw`;

/**
 * The default keyword set, stored as a single comma-separated string so it maps
 * straight into the dropdown's editable input. Sourced from CHANNEL_KEYWORDS so
 * the description dropdown shares the same voice as generated titles/metadata.
 */
export const DEFAULT_VIDEO_KEYWORDS = CHANNEL_KEYWORDS.join(", ");
