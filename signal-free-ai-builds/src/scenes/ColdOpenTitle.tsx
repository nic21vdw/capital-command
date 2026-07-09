import React from "react";
import { AbsoluteFill, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOR_BG, COLOR_BLACK, COLOR_PRIMARY, FONT_FAMILY, WEIGHT } from "../theme";
import { GlowPulse } from "../components/GlowPulse";

// Placeholder note: this cold-open card is placed right after the cold-open
// spoken line, BEFORE the intro. Reposition its <Sequence> in Video.tsx to
// match the live-footage edit.

const WORDS = ["FREE", "AI", "BUILDS"];

/**
 * Scene 1 · 3s (90f). Background fades black -> Signal bg; the wordmark scales
 * in letter-by-letter on staggered springs, over a looping warm glow pulse.
 */
export const ColdOpenTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const bg = interpolateColors(frame, [0, 25], [COLOR_BLACK, COLOR_BG]);

  let letterIndex = 0; // running index for a continuous stagger across words

  return (
    <AbsoluteFill style={{ backgroundColor: bg, justifyContent: "center", alignItems: "center", fontFamily: FONT_FAMILY }}>
      <GlowPulse color={COLOR_PRIMARY} />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        {WORDS.map((word) => (
          <div key={word} style={{ display: "flex" }}>
            {word.split("").map((ch) => {
              const i = letterIndex++;
              const s = spring({ frame: frame - 6 - i * 3, fps, config: { damping: 12, mass: 0.7 } });
              const scale = interpolate(s, [0, 1], [0.3, 1]);
              const y = interpolate(s, [0, 1], [50, 0]);
              return (
                <span
                  key={i}
                  style={{
                    display: "inline-block",
                    fontSize: 168,
                    fontWeight: WEIGHT.black,
                    color: COLOR_PRIMARY,
                    lineHeight: 1.0,
                    letterSpacing: 2,
                    opacity: s,
                    transform: `translateY(${y}px) scale(${scale})`
                  }}
                >
                  {ch}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
