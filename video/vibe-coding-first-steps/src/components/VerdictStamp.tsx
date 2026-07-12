import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { theme, fontFamily, toneColor } from "../theme";

/**
 * The recurring "verdict" beat of the whole short: a single word
 * ("BAD" / "OKAY" / "GOOD") that stamps in with an overshoot bounce, tinted
 * by its tone. `delay` offsets the stamp relative to its host Sequence so the
 * label lands *after* the thing it is judging. Reused on every tier row and
 * on both payoff beats so the format reads as one running gag.
 */
export const VerdictStamp: React.FC<{
  label: string;
  tone: "bad" | "okay" | "good";
  delay?: number;
  fontSize?: number;
}> = ({ label, tone, delay = 0, fontSize = 96 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const color = toneColor(tone);

  // Snappy overshoot so it reads as a rubber-stamp "verdict", not a fade.
  const stamp = spring({
    frame: frame - delay,
    fps,
    config: { damping: 9, mass: 0.7, stiffness: 140 },
  });
  const scale = interpolate(stamp, [0, 1], [1.8, 1]);
  const opacity = interpolate(stamp, [0, 0.35], [0, 1], {
    extrapolateRight: "clamp",
  });
  // A faint tilt sells the "stamped on" feel.
  const rotate = interpolate(stamp, [0, 1], [-8, -3]);

  return (
    <span
      style={{
        display: "inline-block",
        fontFamily,
        fontWeight: 800,
        fontSize,
        letterSpacing: -2,
        color,
        border: `6px solid ${color}`,
        borderRadius: 18,
        padding: "6px 28px",
        transform: `scale(${scale}) rotate(${rotate}deg)`,
        opacity,
        textShadow: `0 0 40px ${color}55`,
        lineHeight: 1.1,
        backgroundColor: `${theme.bg}cc`,
      }}
    >
      {label}
    </span>
  );
};
