import React from "react";
import { AbsoluteFill, useCurrentFrame, random, interpolate } from "remotion";
import { ClaudeSpark } from "./ClaudeSpark";
import { theme, VIDEO } from "../theme";

/**
 * Shared cinematic stage: near-black base, a slowly breathing terracotta
 * glow, a faint vignette, and a field of small drifting starburst marks so
 * the brand is literally in motion behind every scene. Each scene renders
 * its own Backdrop so slides also stand alone in the Segment Deck.
 */
export const Backdrop: React.FC<{ glow?: number }> = ({ glow = 1 }) => {
  const frame = useCurrentFrame();
  const breathe = 0.5 + 0.5 * Math.sin(frame / 22);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, overflow: "hidden" }}>
      {/* breathing brand glow */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 60% 55% at 50% 45%, ${theme.accent}, transparent 70%)`,
          opacity: glow * (0.1 + 0.07 * breathe),
        }}
      />
      <SparkField />
      {/* vignette keeps edges dark so overlaid narration footage reads */}
      <AbsoluteFill
        style={{
          background: "radial-gradient(ellipse 75% 70% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

const SPARK_COUNT = 14;

/** Small Claude sparks drifting upward and spinning, deterministic per index. */
const SparkField: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      {Array.from({ length: SPARK_COUNT }, (_, i) => {
        const seed = `spark-${i}`;
        const size = 14 + random(seed) * 26;
        const x = random(`${seed}-x`) * VIDEO.width;
        const driftSpeed = 0.25 + random(`${seed}-v`) * 0.6;
        const spin = (random(`${seed}-s`) > 0.5 ? 1 : -1) * (0.4 + random(`${seed}-r`) * 0.8);
        // wraps top-to-bottom so the field never empties out
        const travel = VIDEO.height + 80;
        const y = ((random(`${seed}-y`) * travel + frame * driftSpeed * -1) % travel + travel) % travel - 40;
        const opacity = interpolate(random(`${seed}-o`), [0, 1], [0.05, 0.16]);
        return (
          <div key={i} style={{ position: "absolute", left: x, top: y }}>
            <ClaudeSpark size={size} color={theme.accent} rotation={frame * spin} opacity={opacity} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
