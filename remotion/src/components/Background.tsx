import React from "react";
import { AbsoluteFill } from "remotion";
import { COLORS, hexA } from "../config";

/**
 * Background — the dark Dracula base present on every slide.
 * A soft radial vignette plus a very subtle accent bloom keeps flat slides
 * from feeling dead. Purely visual, no motion of its own.
 */
export const Background: React.FC<{
  /** Accent color for the faint corner bloom. */
  bloom?: string;
}> = ({ bloom = COLORS.accent }) => {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 120% at 50% 40%, ${COLORS.background} 0%, ${COLORS.backgroundDeep} 100%)`,
      }}
    >
      {/* Accent bloom, top-left */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(40% 40% at 12% 8%, ${hexA(
            bloom,
            0.16,
          )} 0%, transparent 70%)`,
        }}
      />
      {/* Accent bloom, bottom-right */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(45% 45% at 90% 96%, ${hexA(
            COLORS.accentAlt,
            0.1,
          )} 0%, transparent 70%)`,
        }}
      />
      {/* Fine grain vignette to focus the center */}
      <AbsoluteFill
        style={{
          boxShadow: `inset 0 0 320px ${hexA("#000000", 0.55)}`,
        }}
      />
    </AbsoluteFill>
  );
};
