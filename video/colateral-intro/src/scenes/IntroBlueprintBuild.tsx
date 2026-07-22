import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { BeamBuddy } from "../components/BeamBuddy";
import { BlueprintGrid } from "../components/BlueprintGrid";
import { Wordmark } from "../components/Wordmark";
import { Kicker } from "../components/Kicker";
import { theme, fontFamily } from "../theme";

/**
 * Iteration C — "Blueprint Build" (5s, white).
 *
 * The brand hero, assembled. On a faint blueprint grid the kicker eyebrow fades
 * in, Beam Buddy hops in from the left, and the "CoLateral" wordmark snaps
 * together letter-by-letter like dropped blocks, settling above the product
 * one-liner. Buddy waves to close. Structural, layered, premium — mirrors the
 * CoLateral landing hero in landscape.
 */
export const IntroBlueprintBuild: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Beam Buddy hops in from the left with two little bounces.
  const enter = spring({ frame: frame - 6, fps, config: { damping: 16, mass: 0.9 } });
  const buddyX = interpolate(enter, [0, 1], [-460, 0]);
  const hop = Math.max(0, Math.sin(enter * Math.PI * 2)) * 26 * (1 - enter);

  // Kicker eyebrow fades up first.
  const kick = spring({ frame: frame - 18, fps, config: { damping: 200 } });

  // Wordmark letters drop in as blocks with an overshoot pop, staggered.
  const styleFor = (i: number) => {
    const s = spring({ frame: frame - 40 - i * 4, fps, config: { damping: 12, mass: 0.6 } });
    return {
      opacity: interpolate(s, [0, 0.2, 1], [0, 1, 1]),
      transform: `translateY(${interpolate(s, [0, 1], [-84, 0])}px) scale(${interpolate(
        s,
        [0, 0.55, 1],
        [0.55, 1.14, 1],
      )})`,
    };
  };

  // Subtitle one-liner fades in under the wordmark.
  const sub = spring({ frame: frame - 96, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <BlueprintGrid />

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "row",
          gap: 64,
        }}
      >
        {/* Beam Buddy hopping in */}
        <div style={{ transform: `translate(${buddyX}px, ${-hop}px)` }}>
          <BeamBuddy size={300} waveFrom={108} phase={7} />
        </div>

        {/* Kicker · wordmark · subtitle stack */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 22 }}>
          <div style={{ opacity: kick, transform: `translateY(${interpolate(kick, [0, 1], [16, 0])}px)` }}>
            <Kicker fontSize={26}>The all-in-one engineering workspace</Kicker>
          </div>

          <Wordmark fontSize={150} styleFor={styleFor} />

          <div
            style={{
              maxWidth: 760,
              color: theme.ink,
              opacity: 0.82 * sub,
              fontFamily,
              fontWeight: 500,
              fontSize: 34,
              lineHeight: 1.28,
              transform: `translateY(${interpolate(sub, [0, 1], [14, 0])}px)`,
            }}
          >
            One reviewable, source-tied workspace for structural engineering teams.
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
