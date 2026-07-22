import React from "react";
import { theme, fontFamily } from "../theme";

/**
 * A small rounded speech bubble with a tail on its lower-left — the "I'm
 * reinforced by all your good vibes." aside Beam Buddy delivers in the brand
 * artwork. Pale-blue fill, blue outline, tail points down toward the mascot.
 * Reveal (pop/scale) is the caller's job — wrap in an animated <div>.
 */
export const SpeechBubble: React.FC<{
  children: React.ReactNode;
  width?: number;
  fontSize?: number;
}> = ({ children, width = 260, fontSize = 30 }) => (
  <div style={{ position: "relative", width }}>
    <div
      style={{
        background: theme.sky,
        border: `3px solid ${theme.brand}`,
        borderRadius: 18,
        padding: "16px 20px",
        color: theme.ink,
        fontFamily,
        fontWeight: 700,
        fontSize,
        lineHeight: 1.22,
        textAlign: "center",
        boxShadow: `0 12px 30px -12px ${theme.brandDark}`,
      }}
    >
      {children}
    </div>
    {/* tail */}
    <div
      style={{
        position: "absolute",
        left: 34,
        bottom: -16,
        width: 0,
        height: 0,
        borderLeft: "12px solid transparent",
        borderRight: "12px solid transparent",
        borderTop: `18px solid ${theme.brand}`,
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 37,
        bottom: -10,
        width: 0,
        height: 0,
        borderLeft: "9px solid transparent",
        borderRight: "9px solid transparent",
        borderTop: `14px solid ${theme.sky}`,
      }}
    />
  </div>
);
