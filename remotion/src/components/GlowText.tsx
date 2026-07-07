import React from "react";
import { COLORS, FONT, glow } from "../config";
import { FONT_FAMILY } from "../fonts";

/**
 * GlowText — the base type primitive. Renders bold Dracula-styled text with a
 * consistent glow. Supports multi-line copy via "\n" in the children string.
 */
export const GlowText: React.FC<{
  children: string;
  color?: string;
  fontSize?: number;
  weight?: number;
  glowStrength?: number;
  letterSpacing?: string;
  lineHeight?: number;
  align?: "left" | "center" | "right";
  style?: React.CSSProperties;
}> = ({
  children,
  color = COLORS.foreground,
  fontSize = 96,
  weight = FONT.weightBlack,
  glowStrength = 1,
  letterSpacing = FONT.letterSpacingTight,
  lineHeight = 1.06,
  align = "center",
  style,
}) => {
  return (
    <div
      style={{
        fontFamily: FONT_FAMILY,
        fontWeight: weight,
        fontSize,
        color,
        textAlign: align,
        letterSpacing,
        lineHeight,
        textShadow: glowStrength > 0 ? glow(color, glowStrength) : undefined,
        whiteSpace: "pre-line",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/**
 * Kicker — the small uppercase label that sits above a headline.
 */
export const Kicker: React.FC<{
  children: string;
  color?: string;
}> = ({ children, color = COLORS.accentAlt }) => {
  if (!children) return null;
  return (
    <div
      style={{
        fontFamily: FONT_FAMILY,
        fontWeight: FONT.weightBold,
        fontSize: 26,
        letterSpacing: FONT.letterSpacingWide,
        textTransform: "uppercase",
        color,
        textShadow: glow(color, 0.6),
      }}
    >
      {children}
    </div>
  );
};
