import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { ClaudeSpark } from "../components/ClaudeSpark";
import { theme, serifFamily, sansFamily } from "../theme";

/**
 * Cold open (4s): the starburst spins up from nothing with an overshoot pop
 * and two expanding pulse rings, then the "Claude" serif wordmark and the
 * "BY ANTHROPIC" tag settle in beneath it.
 */
export const LogoReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pop = spring({ frame, fps, config: { damping: 11, mass: 0.9 } });
  const wordmark = spring({ frame: frame - 32, fps, config: { damping: 15 } });
  const tag = spring({ frame: frame - 52, fps, config: { damping: 16 } });

  // the mark decelerates out of the reveal spin, then keeps idling
  const rotation = interpolate(frame, [0, 40, 120], [-160, 0, 24], {
    extrapolateRight: "extend",
  });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <Backdrop />
      <div style={{ position: "relative", width: 300, height: 300 }}>
        {[0, 14].map((delay) => {
          const ring = spring({ frame: frame - 6 - delay, fps, config: { damping: 30 }, durationInFrames: 55 });
          return (
            <div
              key={delay}
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                border: `3px solid ${theme.accent}`,
                transform: `scale(${interpolate(ring, [0, 1], [0.4, 2.1])})`,
                opacity: interpolate(ring, [0, 0.15, 1], [0, 0.5, 0]),
              }}
            />
          );
        })}
        <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <ClaudeSpark size={280} rotation={rotation} scale={pop} />
        </div>
      </div>

      <div
        style={{
          marginTop: 42,
          fontFamily: serifFamily,
          fontSize: 148,
          fontWeight: 500,
          letterSpacing: -2,
          color: theme.ivory,
          opacity: wordmark,
          transform: `translateY(${interpolate(wordmark, [0, 1], [46, 0])}px)`,
          lineHeight: 1,
        }}
      >
        Claude
      </div>
      <div
        style={{
          marginTop: 26,
          fontFamily: sansFamily,
          fontSize: 30,
          fontWeight: 600,
          letterSpacing: 10,
          color: theme.muted,
          opacity: tag,
          transform: `translateY(${interpolate(tag, [0, 1], [18, 0])}px)`,
        }}
      >
        BY ANTHROPIC
      </div>
    </AbsoluteFill>
  );
};
