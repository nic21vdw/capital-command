import React from "react";
import { theme, fontFamily } from "../theme";

/**
 * The hero's eyebrow: uppercase, heavily tracked, filled with the
 * blue→indigo gradient from `.eyebrow` on the front page.
 */
export const Eyebrow: React.FC<{
  children: React.ReactNode;
  fontSize?: number;
  style?: React.CSSProperties;
}> = ({ children, fontSize = 26, style }) => (
  <div
    style={{
      fontFamily,
      fontWeight: 850,
      fontSize,
      letterSpacing: "0.22em",
      textTransform: "uppercase",
      background: `linear-gradient(135deg, ${theme.brand}, ${theme.indigo})`,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
      ...style,
    }}
  >
    {children}
  </div>
);

/** The hero's supporting line — `.tagline`. */
export const Tagline: React.FC<{
  children: React.ReactNode;
  fontSize?: number;
  style?: React.CSSProperties;
}> = ({ children, fontSize = 30, style }) => (
  <div
    style={{
      fontFamily,
      fontSize,
      fontWeight: 450,
      color: theme.tagline,
      lineHeight: 1.55,
      maxWidth: 980,
      textAlign: "center",
      ...style,
    }}
  >
    {children}
  </div>
);

/** The small qualifier under the hero — `.trustline`. */
export const Trustline: React.FC<{
  children: React.ReactNode;
  fontSize?: number;
  style?: React.CSSProperties;
}> = ({ children, fontSize = 20, style }) => (
  <div
    style={{
      fontFamily,
      fontSize,
      fontWeight: 500,
      color: theme.tx3,
      letterSpacing: "0.02em",
      ...style,
    }}
  >
    {children}
  </div>
);
