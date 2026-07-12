import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { ClaudeSpark } from "../components/ClaudeSpark";
import { theme, serifFamily, sansFamily } from "../theme";

/**
 * The thesis (≈4.7s): "BUILT FOR THE HARDEST PROBLEMS" lands word by word,
 * a terracotta rule sweeps in underneath, and a spinning spark sits in the
 * kicker line. This is the beat the narration hangs on.
 */
export const HardestProblems: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const lines: { words: string[]; accentFrom?: number }[] = [
    { words: ["BUILT", "FOR", "THE"] },
    { words: ["HARDEST", "PROBLEMS"], accentFrom: 0 },
  ];

  const kicker = spring({ frame: frame - 6, fps, config: { damping: 16 } });
  const rule = spring({ frame: frame - 46, fps, config: { damping: 18 }, durationInFrames: 40 });

  let wordIndex = 0;
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <Backdrop />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          marginBottom: 40,
          opacity: kicker,
          transform: `translateY(${interpolate(kicker, [0, 1], [20, 0])}px)`,
        }}
      >
        <ClaudeSpark size={44} rotation={frame * 1.6} />
        <span style={{ fontFamily: sansFamily, fontSize: 30, fontWeight: 600, letterSpacing: 8, color: theme.muted }}>
          WHEN IT ACTUALLY MATTERS
        </span>
      </div>

      {lines.map((line, li) => (
        <div key={li} style={{ display: "flex", gap: 34, justifyContent: "center" }}>
          {line.words.map((word, wi) => {
            const s = spring({
              frame: frame - 14 - wordIndex++ * 6,
              fps,
              config: { damping: 13, mass: 0.7 },
            });
            const accent = line.accentFrom !== undefined && wi >= line.accentFrom;
            return (
              <span
                key={wi}
                style={{
                  fontFamily: serifFamily,
                  fontWeight: 600,
                  fontSize: 138,
                  letterSpacing: -1,
                  lineHeight: 1.12,
                  color: accent ? theme.accent : theme.ivory,
                  opacity: s,
                  transform: `translateY(${interpolate(s, [0, 1], [70, 0])}px)`,
                  display: "inline-block",
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
      ))}

      <div
        style={{
          marginTop: 44,
          height: 6,
          width: interpolate(rule, [0, 1], [0, 560]),
          borderRadius: 3,
          backgroundColor: theme.accent,
        }}
      />
    </AbsoluteFill>
  );
};
