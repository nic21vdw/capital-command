import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { GlowBackground } from "../components/GlowBackground";
import { theme, fontFamily } from "../theme";

/**
 * Cold open: "HOW TO START / VIBE CODING" scales in letter-by-letter over the
 * glow, then the "in the simplest terms" tag drops in — that tag is the promise
 * the whole tier-list format pays off.
 */
export const ColdOpenTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lines = ["HOW TO START", "VIBE CODING"];

  const sub = spring({ frame: frame - 36, fps, config: { damping: 18 } });

  let globalIndex = 0;
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <GlowBackground />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        {lines.map((line, li) => (
          <div key={li} style={{ display: "flex", justifyContent: "center" }}>
            {line.split("").map((ch, i) => {
              const s = spring({
                frame: frame - globalIndex++ * 2.4,
                fps,
                config: { damping: 12, mass: 0.6 },
              });
              const y = interpolate(s, [0, 1], [80, 0]);
              const o = interpolate(s, [0, 1], [0, 1]);
              return (
                <span
                  key={i}
                  style={{
                    fontFamily,
                    fontWeight: 800,
                    fontSize: 104,
                    letterSpacing: -3,
                    color: ch === " " ? "transparent" : theme.text,
                    transform: `translateY(${y}px)`,
                    opacity: o,
                    display: "inline-block",
                    width: ch === " " ? 30 : "auto",
                    lineHeight: 1.05,
                  }}
                >
                  {ch}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 36,
          fontFamily,
          fontWeight: 700,
          fontSize: 54,
          letterSpacing: 4,
          color: theme.accent,
          opacity: sub,
          transform: `translateY(${interpolate(sub, [0, 1], [24, 0])}px)`,
        }}
      >
        in the simplest terms
      </div>
    </AbsoluteFill>
  );
};
