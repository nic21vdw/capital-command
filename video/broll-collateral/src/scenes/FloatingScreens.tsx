import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Stage } from "../components/Stage";
import { FloatingScreen } from "../components/FloatingScreen";
import { ScreenVariant } from "../components/AppWindow";
import { clipFade, drift, enter, ramp, SPRING_HERO, SPRING_SMOOTH } from "../motion";
import { CLIP_FRAMES } from "../theme";

/**
 * "Floating Screens" — the hero B-roll shot.
 *
 * Three CoLateral Command screens hang in space at different depths and drift
 * on slow, out-of-phase sine waves, the way the iOS lock-screen widgets and
 * App Store hero shots do. Each one arrives on its own spring with a rise-and-
 * settle (never a linear slide), and the two off-axis screens carry a depth-of-
 * field blur so the eye lands on the hero in the middle.
 *
 * Loops cleanly: the drift periods divide 150 frames, so the last frame lines
 * up with the first.
 */
const LAYERS: {
  variant: ScreenVariant;
  scale: number;
  x: number;
  y: number;
  rotateY: number;
  rotateX: number;
  rotateZ: number;
  blur: number;
  delay: number;
  period: number;
  phase: number;
  amp: number;
  opacity: number;
}[] = [
  // back-left, small and soft
  { variant: "analytics", scale: 0.32, x: -600, y: -230, rotateY: 26, rotateX: 8, rotateZ: -4, blur: 5, delay: 10, period: 150, phase: 0.9, amp: 22, opacity: 0.65 },
  // back-right
  { variant: "calendar", scale: 0.35, x: 600, y: -190, rotateY: -24, rotateX: 7, rotateZ: 3, blur: 4, delay: 6, period: 150, phase: 2.4, amp: 26, opacity: 0.72 },
  // mid-left
  { variant: "ideas", scale: 0.42, x: -430, y: 235, rotateY: 20, rotateX: -6, rotateZ: 3, blur: 2, delay: 14, period: 75, phase: 1.7, amp: 16, opacity: 0.9 },
  // mid-right
  { variant: "clips", scale: 0.44, x: 455, y: 250, rotateY: -18, rotateX: -5, rotateZ: -3, blur: 1.5, delay: 18, period: 75, phase: 3.6, amp: 18, opacity: 0.94 },
  // hero, dead centre and sharp
  { variant: "pipeline", scale: 0.6, x: 0, y: 10, rotateY: -5, rotateX: 3, rotateZ: 0, blur: 0, delay: 0, period: 150, phase: 0, amp: 14, opacity: 1 },
];

export const FloatingScreens: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = clipFade(frame, CLIP_FRAMES);

  // The whole rig eases forward through the clip — a slow push-in, not a zoom.
  const push = enter(frame, fps, 0, SPRING_HERO);
  const dolly = 1 + 0.06 * push + ramp(frame, 20, CLIP_FRAMES) * 0.04;

  return (
    <Stage shiftX={drift(frame, 150) * 26} shiftY={drift(frame, 150, 1.2) * 18}>
      <AbsoluteFill style={{ perspective: 1800, opacity: fade }}>
        <AbsoluteFill style={{ transformStyle: "preserve-3d", transform: `scale(${dolly})` }}>
          {LAYERS.map((layer) => {
            const inSpring = enter(frame, fps, layer.delay, SPRING_SMOOTH);
            const bob = drift(frame, layer.period, layer.phase) * layer.amp;
            const sway = drift(frame, layer.period * 1.5, layer.phase + 1) * (layer.amp * 0.5);
            return (
              <FloatingScreen
                key={layer.variant}
                variant={layer.variant}
                scale={layer.scale * (0.86 + 0.14 * inSpring)}
                x={layer.x + sway}
                y={layer.y + bob + (1 - inSpring) * 70}
                rotateX={layer.rotateX + drift(frame, layer.period * 2, layer.phase) * 1.5}
                rotateY={layer.rotateY}
                rotateZ={layer.rotateZ}
                blur={layer.blur}
                opacity={layer.opacity * inSpring}
                progress={ramp(frame, layer.delay + 8, layer.delay + 96)}
                sheen={layer.blur < 2 ? ramp(frame, 46 + layer.delay, 112 + layer.delay) : -1}
              />
            );
          })}
        </AbsoluteFill>
      </AbsoluteFill>
    </Stage>
  );
};
