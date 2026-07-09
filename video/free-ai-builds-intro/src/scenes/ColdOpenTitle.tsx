import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { GlowBackground } from "../components/GlowBackground";
import { theme, fontFamily } from "../theme";

/** Cold open: "FREE AI BUILDS" scales in, letters staggered, over a glow pulse. */
export const ColdOpenTitle: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Two clean lines so the title never breaks mid-word at this size.
  const lines = ["FREE AI", "BUILDS"];

  const sub = spring({ frame: frame - 34, fps, config: { damping: 18 } });

  let globalIndex = 0;
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <GlowBackground />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        {lines.map((line, li) => (
          <div key={li} style={{ display: "flex", justifyContent: "center" }}>
            {line.split("").map((ch, i) => {
              const s = spring({
                frame: frame - globalIndex++ * 3,
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
                    fontSize: 168,
                    letterSpacing: -4,
                    color: ch === " " ? "transparent" : theme.text,
                    transform: `translateY(${y}px)`,
                    opacity: o,
                    display: "inline-block",
                    width: ch === " " ? 44 : "auto",
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
          marginTop: 32,
          fontFamily,
          fontWeight: 700,
          fontSize: 50,
          letterSpacing: 6,
          color: theme.accent,
          opacity: sub,
          transform: `translateY(${interpolate(sub, [0, 1], [24, 0])}px)`,
        }}
      >
        A NEW SERIES
      </div>
    </AbsoluteFill>
  );
};
