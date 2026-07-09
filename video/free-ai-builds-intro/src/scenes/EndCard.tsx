import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { GlowBackground } from "../components/GlowBackground";
import { theme, fontFamily } from "../theme";

/** End card: "NEXT: BUILD #1" + a follow prompt, glow for continuity. */
export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16 } });
  const sub = spring({ frame: frame - 18, fps, config: { damping: 16 } });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <GlowBackground color={theme.reveal} />
      <div
        style={{
          fontFamily,
          fontWeight: 700,
          fontSize: 46,
          color: theme.text,
          letterSpacing: 10,
          opacity: enter,
        }}
      >
        NEXT
      </div>
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 128,
          color: theme.text,
          letterSpacing: -3,
          opacity: enter,
          transform: `scale(${interpolate(enter, [0, 1], [0.85, 1])})`,
          marginTop: 8,
        }}
      >
        BUILD #1
      </div>
      <div
        style={{
          marginTop: 40,
          display: "flex",
          alignItems: "center",
          gap: 20,
          opacity: sub,
          transform: `translateY(${interpolate(sub, [0, 1], [22, 0])}px)`,
        }}
      >
        {/* Simple SVG bell — no external assets. */}
        <svg width={56} height={56} viewBox="0 0 56 56">
          <path
            d="M28 8a3 3 0 0 1 3 3v1.6a12 12 0 0 1 9 11.6v8l4 5v2H12v-2l4-5v-8a12 12 0 0 1 9-11.6V11a3 3 0 0 1 3-3Z"
            fill={theme.highlight}
          />
          <path d="M23 44a5 5 0 0 0 10 0Z" fill={theme.highlight} />
        </svg>
        <span style={{ fontFamily, fontWeight: 700, fontSize: 50, color: theme.text }}>
          Follow along
        </span>
      </div>
    </AbsoluteFill>
  );
};
