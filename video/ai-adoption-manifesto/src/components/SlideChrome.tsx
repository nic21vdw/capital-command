import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { BRAND, COLORS, FONT, hexA } from "../config";
import { FONT_FAMILY } from "../fonts";

/**
 * SlideChrome — consistent framing shown on manifesto slides:
 *  - the Act label, top-left
 *  - the brand mark + slide number, bottom row
 *  - thin accent progress ticks
 *
 * Kept deliberately quiet so it never competes with the headline.
 */
export const SlideChrome: React.FC<{
  act: string;
  slideId: string;
  accentColor: string;
}> = ({ act, slideId, accentColor }) => {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [4, 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const labelStyle: React.CSSProperties = {
    fontFamily: FONT_FAMILY,
    fontWeight: FONT.weightBold,
    fontSize: 22,
    letterSpacing: FONT.letterSpacingWide,
    textTransform: "uppercase",
    color: hexA(COLORS.foreground, 0.7),
  };

  return (
    <AbsoluteFill style={{ opacity: fade, padding: 64 }}>
      {/* Act label */}
      <div style={{ position: "absolute", top: 56, left: 72 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span
            style={{
              width: 34,
              height: 3,
              background: accentColor,
              boxShadow: `0 0 12px ${hexA(accentColor, 0.9)}`,
            }}
          />
          <span style={labelStyle}>{act}</span>
        </div>
      </div>

      {/* Bottom row: brand + slide number */}
      <div
        style={{
          position: "absolute",
          bottom: 52,
          left: 72,
          right: 72,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            ...labelStyle,
            color: accentColor,
            textShadow: `0 0 14px ${hexA(accentColor, 0.6)}`,
          }}
        >
          {BRAND.name}
        </span>
        <span style={{ ...labelStyle, color: hexA(COLORS.foreground, 0.45) }}>
          {slideId} / 14
        </span>
      </div>
    </AbsoluteFill>
  );
};
