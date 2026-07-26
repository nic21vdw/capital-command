import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Stage } from "../components/Stage";
import { FloatingScreen } from "../components/FloatingScreen";
import { ScreenVariant } from "../components/AppWindow";
import { clipFade, drift, easeIOS, enter, ramp, SPRING_SMOOTH } from "../motion";
import { CLIP_FRAMES } from "../theme";

/**
 * "Vertical Stack" — vertical B-roll, 1080×1920.
 *
 * A column of product screens rides slowly up the frame, tilted away from the
 * camera so the stack has real perspective. Built for Shorts/Reels where the
 * top and bottom thirds get covered by captions and UI — the readable action
 * stays in the middle band.
 */
const STACK: { variant: ScreenVariant; rotateZ: number; x: number }[] = [
  { variant: "analytics", rotateZ: -3, x: -60 },
  { variant: "pipeline", rotateZ: 2.5, x: 70 },
  { variant: "clips", rotateZ: -2, x: -50 },
  { variant: "calendar", rotateZ: 3, x: 60 },
  { variant: "ideas", rotateZ: -2.5, x: -40 },
];

const SPACING = 620;

export const VerticalStack: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = clipFade(frame, CLIP_FRAMES);

  const present = enter(frame, fps, 0, SPRING_SMOOTH);
  // One continuous, decelerating climb — two screen-heights over the clip.
  const scroll = interpolate(frame, [0, CLIP_FRAMES], [0, SPACING * 2.1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeIOS,
  });

  return (
    <Stage tint="#4d97ff" shiftY={-scroll * 0.03} shiftX={drift(frame, 150) * 14}>
      <AbsoluteFill style={{ perspective: 1600, opacity: fade }}>
        <AbsoluteFill style={{ transformStyle: "preserve-3d", transform: "rotateX(6deg)" }}>
          {STACK.map((s, i) => {
            const y = i * SPACING - scroll + 420;
            // Focus band: sharp in the middle of the frame, soft at the edges.
            const dist = Math.abs(y) / 620;
            const blur = Math.min(6, dist * 4.5);
            const opacity = interpolate(dist, [0, 1.6], [1, 0.25], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <FloatingScreen
                key={s.variant}
                variant={s.variant}
                scale={0.62 - dist * 0.05}
                x={s.x + drift(frame, 150, i) * 12}
                y={y}
                z={-dist * 160}
                rotateZ={s.rotateZ}
                rotateY={s.x > 0 ? -8 : 8}
                rotateX={-4}
                blur={blur}
                opacity={opacity * present}
                progress={ramp(frame, 6 + i * 10, 96 + i * 10)}
                sheen={blur < 1 ? ramp(frame, 20 + i * 22, 80 + i * 22) : -1}
              />
            );
          })}
        </AbsoluteFill>
      </AbsoluteFill>
    </Stage>
  );
};
