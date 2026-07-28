import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Stage } from "../components/Stage";
import { FloatingScreen } from "../components/FloatingScreen";
import { ScreenVariant } from "../components/AppWindow";
import { clipFade, drift, easeIOS, ramp } from "../motion";
import { CLIP_FRAMES } from "../theme";

/**
 * "Depth Dolly" — a slow lateral camera move past a wall of product screens.
 *
 * The screens sit at real z-depths inside one `preserve-3d` container, so
 * sliding that container horizontally gives true perspective parallax for
 * free: near screens sweep past fast, far ones barely move. Depth of field is
 * faked off the distance from the focal plane, and everything decelerates on
 * the iOS curve so the move lands rather than stops.
 *
 * Reads well reversed or slowed — it is the most "ad footage" of the set.
 */
const FIELD: { variant: ScreenVariant; x: number; y: number; z: number; rotateY: number }[] = [
  { variant: "ideas", x: -1500, y: -240, z: -520, rotateY: 20 },
  { variant: "clips", x: -700, y: 190, z: -140, rotateY: 16 },
  { variant: "pipeline", x: 180, y: -120, z: 60, rotateY: 12 },
  { variant: "editor", x: 1080, y: 230, z: -300, rotateY: 18 },
  { variant: "calendar", x: 1900, y: -180, z: -60, rotateY: 14 },
  { variant: "analytics", x: 2700, y: 200, z: -480, rotateY: 22 },
];

/** Screens at this depth are sharp; everything else softens with distance. */
const FOCAL_Z = 0;

export const DepthDolly: React.FC = () => {
  const frame = useCurrentFrame();
  const fade = clipFade(frame, CLIP_FRAMES);

  // One continuous glide right-to-left, decelerating into the final frame.
  const cam = interpolate(frame, [0, CLIP_FRAMES], [-260, 1720], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeIOS,
  });

  return (
    <Stage tint="#38d3ee" shiftX={-cam * 0.02} shiftY={drift(frame, 150) * 14}>
      <AbsoluteFill style={{ perspective: 1500, opacity: fade }}>
        <AbsoluteFill
          style={{
            transformStyle: "preserve-3d",
            transform: `translate3d(${-cam}px, 0, 0) rotateY(-6deg)`,
          }}
        >
          {FIELD.map((s, i) => {
            const dof = Math.min(7, Math.abs(s.z - FOCAL_Z) / 90);
            // Distance from the camera's current x — used only to fade the
            // far edges so screens do not pop in at frame boundaries.
            const dx = Math.abs(s.x - cam);
            const edge = interpolate(dx, [900, 1900], [1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <FloatingScreen
                key={s.variant}
                variant={s.variant}
                scale={0.52}
                x={s.x}
                y={s.y + drift(frame, 150, i) * 12}
                z={s.z}
                rotateY={s.rotateY}
                rotateX={s.y > 0 ? -5 : 5}
                blur={dof}
                opacity={0.55 + 0.45 * edge}
                progress={ramp(frame, 10 + i * 6, 90 + i * 6)}
                sheen={dof < 1 ? ramp(frame, 30 + i * 14, 90 + i * 14) : -1}
              />
            );
          })}
        </AbsoluteFill>
      </AbsoluteFill>
    </Stage>
  );
};
