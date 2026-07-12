import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { VerdictStamp } from "../components/VerdictStamp";
import { theme, fontFamily } from "../theme";

/**
 * Payoff beat #2 — the meme "by the way" caveat that lands as a relief, not a
 * catch: "By the way… you don't need to know how to code." → GOOD.
 */
export const ByTheWay: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const kicker = spring({ frame, fps, config: { damping: 18 } });
  const line = spring({ frame: frame - 22, fps, config: { damping: 16 } });

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
          fontWeight: 700,
          fontSize: 52,
          letterSpacing: 4,
          color: theme.accent,
          opacity: kicker,
          transform: `translateY(${interpolate(kicker, [0, 1], [-20, 0])}px)`,
        }}
      >
        BY THE WAY
      </div>
      <div style={{ height: 40 }} />
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 84,
          color: theme.text,
          textAlign: "center",
          lineHeight: 1.15,
          maxWidth: 900,
          opacity: line,
          transform: `translateY(${interpolate(line, [0, 1], [40, 0])}px)`,
        }}
      >
        you don&apos;t need to know{" "}
        <span style={{ color: theme.reveal }}>how to code</span>
      </div>
      <div style={{ height: 64 }} />
      <VerdictStamp label="GOOD" tone="good" delay={52} fontSize={120} />
    </AbsoluteFill>
  );
};
