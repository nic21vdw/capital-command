import type { LongformHighlightPassage } from "./types";

/** Count evidence on the current edit, including passages enabled by hand. */
export function highlightCoverage(passages: ReadonlyArray<Pick<LongformHighlightPassage, "enabled" | "visual">>) {
  const kept = passages.filter((passage) => passage.enabled);
  const vision = kept.filter((passage) => passage.visual?.source === "vision" && passage.visual.verdict === "keep").length;
  const scan = kept.filter((passage) => passage.visual?.source === "scan" && passage.visual.verdict === "keep").length;
  const total = kept.length;
  const rejected = kept.filter((passage) => passage.visual?.verdict === "drop").length;
  const unchecked = total - vision - scan - rejected;
  const level = total > 0 && vision === total ? "vision" : scan > 0 ? "scan" : "none";
  return { total, vision, scan, rejected, unchecked, level } as const;
}
