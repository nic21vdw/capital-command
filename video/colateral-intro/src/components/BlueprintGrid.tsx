import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import { theme } from "../theme";

/**
 * Faint blueprint grid on white — a nod to CoLateral's structural-engineering
 * roots. Fades up softly at the start and stays subtle so it never fights the
 * wordmark. Purely decorative background.
 */
export const BlueprintGrid: React.FC<{ cell?: number }> = ({ cell = 96 }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: theme.bg,
        opacity,
        backgroundImage: `linear-gradient(${theme.grid} 1px, transparent 1px), linear-gradient(90deg, ${theme.grid} 1px, transparent 1px)`,
        backgroundSize: `${cell}px ${cell}px`,
        // soft radial vignette so the grid dissolves toward the edges
        WebkitMaskImage:
          "radial-gradient(ellipse 70% 70% at 50% 50%, #000 40%, transparent 100%)",
        maskImage:
          "radial-gradient(ellipse 70% 70% at 50% 50%, #000 40%, transparent 100%)",
      }}
    />
  );
};
