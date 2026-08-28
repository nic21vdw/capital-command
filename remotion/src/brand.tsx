import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { FONT_STACK } from "./theme";

// Dracula signature palette (matches Capital Command). Coral kept for optional
// "Claude/Anthropic-topic" videos.
export const DRACULA_PINK = "#ff79c6";
export const DRACULA_PURPLE = "#bd93f9";
export const DRACULA_CYAN = "#8be9fd";
export const CLAUDE_CORAL = "#D97757";
export const CLAUDE_CREAM = "#F0EEE6";

// A radiating spark: N tapered rays with organic length variation.
export const ClaudeSpark: React.FC<{
  size: number;
  color?: string;
  opacity?: number;
  spin?: number;
}> = ({ size, color = DRACULA_PINK, opacity = 1, spin = 0 }) => {
  const rays = 12;
  const c = size / 2;
  const inner = size * 0.1;
  const outer = size * 0.5;
  const variation = [1, 0.72, 0.88, 0.72];
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ transform: `rotate(${spin}deg)`, display: "block" }}
    >
      <g
        stroke={color}
        strokeWidth={size * 0.055}
        strokeLinecap="round"
        opacity={opacity}
      >
        {Array.from({ length: rays }).map((_, i) => {
          const a = ((i * (360 / rays)) * Math.PI) / 180;
          const len = outer * variation[i % variation.length];
          return (
            <line
              key={i}
              x1={c + Math.cos(a) * inner}
              y1={c + Math.sin(a) * inner}
              x2={c + Math.cos(a) * len}
              y2={c + Math.sin(a) * len}
            />
          );
        })}
      </g>
    </svg>
  );
};

// The signature "channel bug" - the channel's name, bottom-right, on every
// segment. Empty draws nothing, which is what an install that has not said
// whose it is gets; it used to default to one person's name.
const Signature: React.FC<{ name: string; color: string; sparkColor: string }> = ({
  name,
  color,
  sparkColor,
}) => (
  <div
    style={{
      position: "absolute",
      right: 72,
      bottom: 60,
      display: "flex",
      alignItems: "center",
      gap: 14,
    }}
  >
    <ClaudeSpark size={22} color={sparkColor} opacity={0.9} />
    <div
      style={{
        fontFamily: FONT_STACK,
        fontSize: 24,
        fontWeight: 600,
        letterSpacing: 4,
        textTransform: "uppercase",
        color,
      }}
    >
      {name}
    </div>
  </div>
);

// Brand layer: a faint accent glow (gentle pulse) + scattered sparks + the
// signature. `accent` drives the glow so it tracks whatever theme is used;
// `sparkColor` defaults to the Dracula identity; `signature` defaults to empty.
export const BrandDecor: React.FC<{
  accent?: string;
  sparkColor?: string;
  signature?: string;
  showSignature?: boolean;
}> = ({
  accent = DRACULA_PURPLE,
  sparkColor = DRACULA_PINK,
  signature = "",
  showSignature = true,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const spin = frame * 0.25;
  // Slow breathing glow across the whole segment.
  const pulse = interpolate(
    Math.sin((frame / Math.max(durationInFrames, 1)) * Math.PI * 4),
    [-1, 1],
    [0.06, 0.16],
  );
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* dynamic accent glow, top-right */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(1100px 700px at 82% 8%, ${accent}${Math.round(
            pulse * 255,
          )
            .toString(16)
            .padStart(2, "0")}, transparent 60%)`,
        }}
      />
      <div style={{ position: "absolute", bottom: -160, left: -160 }}>
        <ClaudeSpark size={560} color={sparkColor} spin={-spin * 0.4} opacity={0.05} />
      </div>
      <div style={{ position: "absolute", top: 72, right: 96 }}>
        <ClaudeSpark size={72} color={sparkColor} spin={spin} opacity={0.95} />
      </div>
      <div style={{ position: "absolute", top: 128, right: 210 }}>
        <ClaudeSpark size={24} color={sparkColor} spin={spin * 1.6} opacity={0.5} />
      </div>
      {showSignature && signature && (
        <Signature name={signature} color={sparkColor} sparkColor={sparkColor} />
      )}
    </AbsoluteFill>
  );
};
