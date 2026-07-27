import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { ClaudeSpark } from "../components/ClaudeSpark";
import { theme, serifFamily, sansFamily } from "../theme";

/**
 * End card (3s): the spark idles with a heartbeat pulse next to the wordmark,
 * with the claude.ai call-to-action beneath — the hold frame for the outro
 * voiceover.
 */
export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 14 } });
  const cta = spring({ frame: frame - 24, fps, config: { damping: 16 } });
  const pulse = 1 + 0.045 * Math.sin(frame / 7);

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <Backdrop />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 52,
          opacity: enter,
          transform: `translateY(${interpolate(enter, [0, 1], [50, 0])}px)`,
        }}
      >
        <ClaudeSpark size={190} rotation={frame * 0.8} scale={pulse} />
        <span
          style={{
            fontFamily: serifFamily,
            fontSize: 190,
            fontWeight: 500,
            letterSpacing: -3,
            color: theme.ivory,
            lineHeight: 1,
          }}
        >
          Claude
        </span>
      </div>

      <div
        style={{
          marginTop: 56,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
          opacity: cta,
          transform: `translateY(${interpolate(cta, [0, 1], [24, 0])}px)`,
        }}
      >
        <span style={{ fontFamily: sansFamily, fontSize: 40, fontWeight: 600, color: theme.accent, letterSpacing: 2 }}>
          claude.ai
        </span>
        <span style={{ fontFamily: sansFamily, fontSize: 26, fontWeight: 600, letterSpacing: 9, color: theme.muted }}>
          BY ANTHROPIC
        </span>
      </div>
    </AbsoluteFill>
  );
};
