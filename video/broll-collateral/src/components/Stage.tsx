import React from "react";
import { AbsoluteFill } from "remotion";
import { theme } from "../theme";
import { hexA } from "./ui";

/**
 * The shared backdrop for every B-roll clip: a dark mesh-gradient room with a
 * faint blueprint grid and a vignette. Nothing in here moves fast — it exists
 * so the floating product screens have depth to sit in, and so a cut between
 * two different clips still feels like the same world.
 */
export const Stage: React.FC<{
  children?: React.ReactNode;
  /** Slow parallax offset in px, usually driven by `drift()`. */
  shiftX?: number;
  shiftY?: number;
  /** Extra tint for a clip that wants its own mood. */
  tint?: string;
  grid?: boolean;
}> = ({ children, shiftX = 0, shiftY = 0, tint = theme.accent, grid = true }) => (
  <AbsoluteFill style={{ backgroundColor: theme.bgDeep, overflow: "hidden" }}>
    {/* mesh gradient blobs */}
    <AbsoluteFill
      style={{
        transform: `translate(${shiftX}px, ${shiftY}px) scale(1.15)`,
        background: [
          `radial-gradient(52% 46% at 22% 26%, ${hexA(tint, 0.34)} 0%, transparent 62%)`,
          `radial-gradient(46% 40% at 82% 22%, ${hexA(theme.violet, 0.26)} 0%, transparent 64%)`,
          `radial-gradient(60% 52% at 68% 88%, ${hexA(theme.brand, 0.24)} 0%, transparent 66%)`,
          `radial-gradient(40% 36% at 12% 84%, ${hexA(theme.cyan, 0.16)} 0%, transparent 62%)`,
        ].join(", "),
      }}
    />

    {grid && (
      <AbsoluteFill
        style={{
          transform: `translate(${shiftX * 0.45}px, ${shiftY * 0.45}px)`,
          backgroundImage: [
            `linear-gradient(${hexA("#ffffff", 0.035)} 1px, transparent 1px)`,
            `linear-gradient(90deg, ${hexA("#ffffff", 0.035)} 1px, transparent 1px)`,
          ].join(", "),
          backgroundSize: "72px 72px",
          maskImage: "radial-gradient(70% 62% at 50% 50%, #000 20%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(70% 62% at 50% 50%, #000 20%, transparent 100%)",
        }}
      />
    )}

    {children}

    {/* vignette, always on top of the content */}
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        background: `radial-gradient(78% 72% at 50% 46%, transparent 48%, ${hexA(theme.bgDeep, 0.7)} 100%)`,
      }}
    />
  </AbsoluteFill>
);

/**
 * Soft light bloom behind a hero element — sells the "screen is emitting light"
 * look without needing a real blur filter (expensive in headless Chromium).
 */
export const Bloom: React.FC<{ color?: string; size?: number; opacity?: number; style?: React.CSSProperties }> = ({
  color = theme.accent,
  size = 900,
  opacity = 0.5,
  style,
}) => (
  <div
    style={{
      position: "absolute",
      width: size,
      height: size,
      left: "50%",
      top: "50%",
      marginLeft: -size / 2,
      marginTop: -size / 2,
      borderRadius: "50%",
      background: `radial-gradient(circle, ${hexA(color, 0.55)} 0%, transparent 68%)`,
      opacity,
      pointerEvents: "none",
      ...style,
    }}
  />
);
