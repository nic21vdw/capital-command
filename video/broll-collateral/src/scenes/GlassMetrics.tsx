import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Stage } from "../components/Stage";
import { FloatingScreen } from "../components/FloatingScreen";
import { clipFade, drift, ramp, SPRING_POP, SPRING_SMOOTH, stagger } from "../motion";
import { CLIP_FRAMES, theme, fontFamily } from "../theme";
import { hexA, Kicker, Text } from "../components/ui";

/**
 * "Glass Metrics" — frosted result tiles over out-of-focus product footage.
 *
 * The numbers are the ad's claim, so they get the strongest motion: each tile
 * rises on a popping spring and its value counts up on an eased ramp that
 * finishes early, leaving a beat of stillness before the cut. The glass is real
 * `backdrop-filter`, so the blurred screens behind actually show through.
 */
const TILES = [
  { label: "Clips per stream", to: 12, suffix: "", accent: theme.violet },
  { label: "Hours saved / week", to: 9.5, suffix: "h", accent: theme.accent, decimals: 1 },
  { label: "Posts scheduled", to: 72, suffix: "", accent: theme.mint },
  { label: "Formats from one upload", to: 6, suffix: "", accent: theme.amber },
];

export const GlassMetrics: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = clipFade(frame, CLIP_FRAMES);

  return (
    <Stage tint="#4f7dff" shiftX={drift(frame, 150, 0.6) * 24} shiftY={drift(frame, 150, 2.2) * 16}>
      <AbsoluteFill style={{ perspective: 1800, opacity: fade }}>
        {/* out-of-focus product footage behind the glass */}
        <AbsoluteFill style={{ transformStyle: "preserve-3d" }}>
          <FloatingScreen variant="pipeline" scale={0.56} x={-540} y={-230 + drift(frame, 150) * 16} z={-320} rotateY={22} blur={7} opacity={0.6} progress={ramp(frame, 0, 110)} />
          <FloatingScreen variant="analytics" scale={0.6} x={560} y={210 + drift(frame, 150, 2) * 18} z={-260} rotateY={-20} blur={6} opacity={0.62} progress={ramp(frame, 6, 116)} />
          <FloatingScreen variant="clips" scale={0.5} x={120} y={-330 + drift(frame, 150, 3.4) * 14} z={-520} rotateY={-6} blur={8} opacity={0.42} progress={0.9} />
        </AbsoluteFill>

        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", gap: 26 }}>
            {TILES.map((tile, i) => {
              const pop = stagger(frame, fps, i, 8, 6, SPRING_POP);
              const count = stagger(frame, fps, i, 12, 6, SPRING_SMOOTH);
              const value = tile.to * count;
              return (
                <div
                  key={tile.label}
                  style={{
                    width: 340,
                    padding: "34px 30px 30px",
                    borderRadius: 30,
                    fontFamily,
                    opacity: pop,
                    transform: `translateY(${(1 - pop) * 60}px) scale(${0.9 + 0.1 * pop})`,
                    // Tinted glass: each tile picks up its own accent so the row
                    // reads as four materials rather than four grey rectangles.
                    background: `linear-gradient(155deg, ${hexA("#ffffff", 0.15)}, ${hexA(tile.accent, 0.1)} 55%, ${hexA(
                      "#ffffff",
                      0.03
                    )})`,
                    border: `1px solid ${hexA(tile.accent, 0.3)}`,
                    boxShadow: `0 40px 90px -26px rgba(0,0,0,0.9), inset 0 1px 0 ${hexA("#ffffff", 0.25)}`,
                    backdropFilter: "blur(30px)",
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 6,
                      borderRadius: 3,
                      marginBottom: 22,
                      background: tile.accent,
                      boxShadow: `0 0 20px 4px ${hexA(tile.accent, 0.6)}`,
                    }}
                  />
                  <Text size={72} weight={700} style={{ letterSpacing: -2, lineHeight: 1 }}>
                    {value.toFixed(tile.decimals ?? 0)}
                    <span style={{ fontSize: 44, color: tile.accent }}>{tile.suffix}</span>
                  </Text>
                  <div style={{ marginTop: 16 }}>
                    <Kicker size={15}>{tile.label}</Kicker>
                  </div>
                </div>
              );
            })}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </Stage>
  );
};
