import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Stage } from "../components/Stage";
import { FloatingScreen } from "../components/FloatingScreen";
import { clipFade, drift, enter, ramp, SPRING_HERO, SPRING_POP, stagger } from "../motion";
import { CLIP_FRAMES, theme, fontFamily } from "../theme";
import { hexA } from "../components/ui";

/**
 * "Pipeline Flow" — one stream in, every format out.
 *
 * The Stream Pipeline screen presents like an iOS sheet (rises from below,
 * decelerating), its stages fill in sequence, and then the output formats fly
 * out of the screen's right edge along an arc — each on its own popping spring
 * so they land like notification pills rather than sliding in on a rail.
 */
const OUTPUTS = [
  { label: "Long-form", color: theme.accent, y: -290 },
  { label: "12 Shorts", color: theme.violet, y: -150 },
  { label: "MP3", color: theme.cyan, y: -10 },
  { label: "Carousels", color: theme.amber, y: 130 },
  { label: "X / Threads", color: theme.pink, y: 270 },
];

export const PipelineFlow: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = clipFade(frame, CLIP_FRAMES);

  // iOS sheet presentation: up from below, overshoot-free deceleration.
  const present = enter(frame, fps, 0, SPRING_HERO);
  const stagesProgress = ramp(frame, 16, 108);

  return (
    <Stage shiftX={drift(frame, 150) * 20} shiftY={drift(frame, 150, 1.6) * 14}>
      <AbsoluteFill style={{ perspective: 1900, opacity: fade }}>
        <AbsoluteFill style={{ transformStyle: "preserve-3d" }}>
          <FloatingScreen
            variant="pipeline"
            scale={0.66 * (0.9 + 0.1 * present)}
            x={-250}
            y={(1 - present) * 260 + drift(frame, 150) * 10}
            rotateY={9}
            rotateX={3}
            opacity={present}
            progress={stagesProgress}
            sheen={ramp(frame, 34, 100)}
          />

          {/* Formats flying out of the screen's right edge. */}
          {OUTPUTS.map((out, i) => {
            const pop = stagger(frame, fps, i, 44, 7, SPRING_POP);
            const float = drift(frame, 150, i * 1.2) * 9;
            return (
              <div
                key={out.label}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: `translate3d(${290 + (1 - pop) * -190}px, ${out.y + float}px, ${
                    pop * 90
                  }px) scale(${0.72 + 0.28 * pop})`,
                  opacity: pop,
                }}
              >
                <OutputPill label={out.label} color={out.color} />
              </div>
            );
          })}

          {/* Connector: light travelling from the screen out to the pills. */}
          <Connector progress={ramp(frame, 40, 104)} />
        </AbsoluteFill>
      </AbsoluteFill>
    </Stage>
  );
};

const OutputPill: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "16px 26px 16px 18px",
      borderRadius: 20,
      fontFamily,
      fontSize: 26,
      fontWeight: 600,
      color: theme.text,
      whiteSpace: "nowrap",
      background: `linear-gradient(150deg, ${hexA("#ffffff", 0.1)}, ${hexA("#ffffff", 0.03)})`,
      border: `1px solid ${hexA(color, 0.45)}`,
      boxShadow: `0 24px 60px -18px rgba(0,0,0,0.85), inset 0 1px 0 ${hexA("#ffffff", 0.16)}`,
      backdropFilter: "blur(18px)",
    }}
  >
    <div
      style={{
        width: 12,
        height: 12,
        borderRadius: 6,
        background: color,
        boxShadow: `0 0 18px 4px ${hexA(color, 0.7)}`,
      }}
    />
    {label}
  </div>
);

/** A soft light trail from the screen edge toward the output pills. */
const Connector: React.FC<{ progress: number }> = ({ progress }) => (
  <div
    style={{
      position: "absolute",
      left: "50%",
      top: "50%",
      width: 260,
      height: 640,
      marginLeft: 40,
      marginTop: -320,
      opacity: progress * 0.8,
      background: `radial-gradient(ellipse at left center, ${hexA(theme.accentStrong, 0.35)} 0%, transparent 72%)`,
      filter: "blur(24px)",
      pointerEvents: "none",
    }}
  />
);
