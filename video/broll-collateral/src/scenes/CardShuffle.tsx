import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Stage } from "../components/Stage";
import { FloatingScreen } from "../components/FloatingScreen";
import { ScreenVariant } from "../components/AppWindow";
import { clipFade, drift, easeIOS, enter, ramp, SPRING_SMOOTH } from "../motion";
import { CLIP_FRAMES } from "../theme";

/**
 * "Card Shuffle" — the iOS app-switcher move.
 *
 * The screens start collapsed into a single deck, fan out into a shallow arc
 * the way cards do when you swipe up on an iPhone, hold, and then settle back
 * toward the deck. The whole fan runs on one spring so every card decelerates
 * together, and the cards behind the front one dim and blur with depth.
 */
const DECK: ScreenVariant[] = ["analytics", "calendar", "clips", "ideas", "pipeline"];

export const CardShuffle: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = clipFade(frame, CLIP_FRAMES);

  // fan out (spring), hold, then ease back in — one continuous gesture.
  const out = enter(frame, fps, 4, SPRING_SMOOTH);
  const back = interpolate(frame, [104, CLIP_FRAMES], [0, 0.45], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeIOS,
  });
  const spread = Math.max(0, out - back);

  return (
    <Stage tint="#6f97ff" shiftX={drift(frame, 150) * 18} shiftY={drift(frame, 150, 2) * 12}>
      <AbsoluteFill style={{ perspective: 2200, opacity: fade }}>
        <AbsoluteFill style={{ transformStyle: "preserve-3d" }}>
          {DECK.map((variant, i) => {
            // 0 at the front card, 1 at the back of the deck.
            const depth = (DECK.length - 1 - i) / (DECK.length - 1);
            const arc = i - (DECK.length - 1) / 2; // -2 … 2

            // Spacing beats card width so neighbours stay readable rather than
            // collapsing into one muddy stack once the fan is fully open.
            const x = arc * 620 * spread;
            const y = -Math.cos((arc / 2) * 0.9) * 40 * spread + depth * 26;
            const rotY = -arc * 15 * spread;
            const rotZ = arc * 2.4 * spread;
            const scale = 0.52 - depth * 0.05 * (1 - spread) - Math.abs(arc) * 0.024 * spread;

            // Cards ride out one after another, iOS-style, on the same curve.
            const reveal = ramp(frame, 4 + Math.abs(arc) * 5, 34 + Math.abs(arc) * 5);

            return (
              <FloatingScreen
                key={variant}
                variant={variant}
                scale={scale * (0.9 + 0.1 * reveal)}
                x={x}
                y={y + (1 - reveal) * 40 + drift(frame, 150, i) * 8}
                z={-depth * 220 * (1 - spread)}
                rotateY={rotY}
                rotateZ={rotZ}
                rotateX={4 * spread}
                blur={Math.abs(arc) * 1.1 * spread}
                opacity={(1 - depth * 0.35 * (1 - spread)) * reveal}
                progress={ramp(frame, 20, 120)}
                sheen={arc === 0 ? ramp(frame, 52, 118) : -1}
              />
            );
          })}
        </AbsoluteFill>
      </AbsoluteFill>
    </Stage>
  );
};
