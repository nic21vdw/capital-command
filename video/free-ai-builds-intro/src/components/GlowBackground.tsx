import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import { theme } from "../theme";

/**
 * Full-frame near-black background with a slow, looping radial glow pulse.
 * Reused across the cold open and end card for visual consistency.
 */
export const GlowBackground: React.FC<{ color?: string }> = ({
  color = theme.accent,
}) => {
  const frame = useCurrentFrame();
  // Gentle breathing pulse (~2.5s cycle).
  const t = (Math.sin((frame / 75) * Math.PI) + 1) / 2;
  const opacity = interpolate(t, [0, 1], [0.12, 0.32]);
  const scale = interpolate(t, [0, 1], [0.9, 1.08]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: theme.bg,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 1400,
          height: 1400,
          transform: `translate(-50%, -50%) scale(${scale})`,
          background: `radial-gradient(circle, ${color} 0%, rgba(0,0,0,0) 62%)`,
          opacity,
        }}
      />
    </div>
  );
};
