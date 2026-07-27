import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { VerdictStamp } from "../components/VerdictStamp";
import { theme, fontFamily } from "../theme";

/**
 * Payoff beat #1: "Buy the $20 account." → GOOD. The instruction rises in,
 * the price is the highlight, then the verdict stamps to close the joke.
 */
export const TheMove: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16 } });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.bg,
        justifyContent: "center",
        alignItems: "center",
        padding: 90,
      }}
    >
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 96,
          color: theme.text,
          textAlign: "center",
          lineHeight: 1.15,
          opacity: enter,
          transform: `translateY(${interpolate(enter, [0, 1], [40, 0])}px)`,
        }}
      >
        Buy the{" "}
        <span style={{ color: theme.highlight }}>$20</span> account
      </div>
      <div style={{ height: 72 }} />
      <VerdictStamp label="GOOD" tone="good" delay={40} fontSize={120} />
    </AbsoluteFill>
  );
};
