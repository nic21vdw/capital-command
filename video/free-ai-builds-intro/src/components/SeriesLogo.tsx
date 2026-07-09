import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { theme, fontFamily } from "../theme";

/**
 * Standalone, reusable series bumper: a spark icon + "FREE AI BUILDS".
 * Drop this into any future episode as the intro logo. `delay` offsets the
 * spring so it can be sequenced independently of its parent's frame 0.
 */
export const SeriesLogo: React.FC<{ delay?: number }> = ({ delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    frame: frame - delay,
    fps,
    config: { damping: 14, mass: 0.7 },
  });
  const scale = interpolate(enter, [0, 1], [0.6, 1]);
  const opacity = interpolate(enter, [0, 1], [0, 1]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 28,
        transform: `scale(${scale})`,
        opacity,
      }}
    >
      {/* Spark icon — rounded square with a plus/spark, pure SVG (no assets). */}
      <svg width={96} height={96} viewBox="0 0 96 96">
        <rect x="4" y="4" width="88" height="88" rx="24" fill={theme.accent} />
        <path
          d="M48 24 L54 42 L72 48 L54 54 L48 72 L42 54 L24 48 L42 42 Z"
          fill={theme.bg}
        />
      </svg>
      <span
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 72,
          letterSpacing: -1,
          color: theme.text,
          lineHeight: 1,
        }}
      >
        FREE AI BUILDS
      </span>
    </div>
  );
};
