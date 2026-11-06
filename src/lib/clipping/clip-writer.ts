/**
 * Picking clips, judging them and titling them are taste, so they run on Claude
 * through the machine's own Claude Code login (the same route carousels use)
 * and fall back to the configured models when the CLI is missing or silent.
 * `CLIP_WRITER=off` sends them straight to the configured models.
 */
export const CLIP_WRITER = { writer: "claude-code", writerSwitch: "CLIP_WRITER" } as const;
