import React from "react";
import { CLAUDE_SPARK_PATH, theme } from "../theme";

/**
 * The Claude starburst mark. Purely presentational — callers animate it by
 * passing `rotation` / `scale` (or wrapping it) so every appearance of the
 * logo in the trailer is in motion.
 */
export const ClaudeSpark: React.FC<{
  size: number;
  color?: string;
  rotation?: number;
  scale?: number;
  opacity?: number;
  style?: React.CSSProperties;
}> = ({ size, color = theme.accent, rotation = 0, scale = 1, opacity = 1, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    style={{
      transform: `rotate(${rotation}deg) scale(${scale})`,
      opacity,
      display: "block",
      ...style,
    }}
  >
    <path d={CLAUDE_SPARK_PATH} fill={color} />
  </svg>
);
