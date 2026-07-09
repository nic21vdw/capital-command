import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOR_BG, COLOR_PRIMARY, COLOR_TEXT, FONT_FAMILY, WEIGHT } from "../theme";
import { GlowPulse } from "../components/GlowPulse";

/**
 * Scene 5 · 3s (90f). "NEXT: BUILD #1" fades in centred; below it a subscribe
 * bell (SVG) in orange-red with "Follow along". Same warm glow pulse as the
 * cold open, so the series bookends match.
 */
export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const titleY = interpolate(frame, [0, 20], [30, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const cta = spring({ frame: frame - 16, fps, config: { damping: 14, mass: 0.8 } });
  const bellRing = Math.sin((frame / fps) * Math.PI * 2 * 1.2) * interpolate(cta, [0, 1], [0, 8]);

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", fontFamily: FONT_FAMILY }}>
      <GlowPulse color={COLOR_PRIMARY} />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 70 }}>
        <div
          style={{
            fontSize: 132,
            fontWeight: WEIGHT.black,
            color: COLOR_TEXT,
            letterSpacing: 2,
            textAlign: "center",
            lineHeight: 1.05,
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`
          }}
        >
          NEXT: BUILD #1
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 26,
            opacity: cta,
            transform: `scale(${interpolate(cta, [0, 1], [0.85, 1])})`
          }}
        >
          {/* subscribe bell (SVG placeholder) with a subtle ring wobble */}
          <svg width={96} height={96} viewBox="0 0 96 96" style={{ transform: `rotate(${bellRing}deg)`, transformOrigin: "50% 12%" }}>
            <path
              d="M48 14c-13 0-22 9-22 24 0 18-7 22-7 22h58s-7-4-7-22c0-15-9-24-22-24z"
              fill={COLOR_PRIMARY}
            />
            <circle cx={48} cy={82} r={9} fill={COLOR_PRIMARY} />
            <circle cx={48} cy={12} r={6} fill={COLOR_PRIMARY} />
            {/* small knock-out so the bell reads as an icon on the dark bg */}
            <rect x={30} y={62} width={36} height={5} rx={2.5} fill={COLOR_BG} />
          </svg>
          <div style={{ fontSize: 60, fontWeight: WEIGHT.bold, color: COLOR_TEXT }}>Follow along</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
