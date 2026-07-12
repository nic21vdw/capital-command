import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { theme, fontFamily, toneColor } from "../theme";
import { VerdictStamp } from "./VerdictStamp";

/**
 * One row of the "simplest terms" tier list: a name (Gemini / ChatGPT /
 * Claude) slides in from the left, then its verdict stamps in a few frames
 * later. `verdictDelay` is relative to this row's own frame 0. A left accent
 * bar is tinted by tone so the colour reads even before the word lands.
 */
export const TierRow: React.FC<{
  name: string;
  verdict: string;
  tone: "bad" | "okay" | "good";
  verdictDelay?: number;
}> = ({ name, verdict, tone, verdictDelay = 20 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const color = toneColor(tone);

  const enter = spring({ frame, fps, config: { damping: 16 } });
  const x = interpolate(enter, [0, 1], [-90, 0]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 44,
        transform: `translateX(${x}px)`,
        opacity: enter,
      }}
    >
      <div
        style={{
          width: 16,
          height: 108,
          backgroundColor: color,
          borderRadius: 8,
        }}
      />
      <span
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 92,
          letterSpacing: -2,
          color: theme.text,
          minWidth: 520,
        }}
      >
        {name}
      </span>
      <VerdictStamp label={verdict} tone={tone} delay={verdictDelay} fontSize={76} />
    </div>
  );
};
