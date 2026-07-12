import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { GlowBackground } from "../components/GlowBackground";
import { theme, fontFamily } from "../theme";

/**
 * Cold open hook: "AI IS THE NEW / INDUSTRIAL / REVOLUTION" scales in
 * letter-by-letter over the glow, then the "of modern times" tag drops in —
 * this is the claim the rest of the short backs up.
 */
export const ColdOpenHook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lines = ["AI IS THE NEW", "INDUSTRIAL", "REVOLUTION"];

  const sub = spring({ frame: frame - 48, fps, config: { damping: 18 } });

  let globalIndex = 0;
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <GlowBackground />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        {lines.map((line, li) => (
          <div key={li} style={{ display: "flex", justifyContent: "center" }}>
            {line.split("").map((ch, i) => {
              const s = spring({
                frame: frame - globalIndex++ * 1.8,
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
                    fontSize: li === 0 ? 84 : 110,
                    letterSpacing: -3,
                    color: ch === " " ? "transparent" : li === 0 ? theme.text : theme.accent,
                    transform: `translateY(${y}px)`,
                    opacity: o,
                    display: "inline-block",
                    width: ch === " " ? 28 : "auto",
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
          fontSize: 52,
          letterSpacing: 4,
          color: theme.highlight,
          opacity: sub,
          transform: `translateY(${interpolate(sub, [0, 1], [24, 0])}px)`,
        }}
      >
        of modern times
      </div>
    </AbsoluteFill>
  );
};
