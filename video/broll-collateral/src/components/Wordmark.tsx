import React from "react";
import { theme, fontFamily } from "../theme";

/**
 * The CoLateral wordmark for dark backgrounds — "Co" in near-white, "Lateral"
 * in the brand blue. (The white-background version lives in
 * `video/colateral-intro`; this one is tuned for the dark B-roll stage.)
 */
export const Wordmark: React.FC<{ fontSize?: number; opacity?: number }> = ({ fontSize = 120, opacity = 1 }) => (
  <div
    style={{
      fontFamily,
      fontSize,
      fontWeight: 700,
      letterSpacing: -fontSize * 0.028,
      lineHeight: 1,
      opacity,
      whiteSpace: "nowrap",
    }}
  >
    <span style={{ color: theme.text }}>Co</span>
    <span
      style={{
        background: `linear-gradient(100deg, ${theme.brandLight}, ${theme.accentStrong} 55%, ${theme.violet})`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
      }}
    >
      Lateral
    </span>
  </div>
);
