import React from "react";
import { useCurrentFrame } from "remotion";
import { BEAT_FRAMES, fontFamily, theme } from "../theme";

export const Signature: React.FC = () => {
  const frame = useCurrentFrame();
  const beat = 0.5 + 0.5 * Math.sin((frame / BEAT_FRAMES) * Math.PI * 2);

  return (
    <div
      style={{
        position: "absolute",
        right: 48,
        bottom: 28,
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily,
        color: theme.soft,
        fontSize: 14,
        letterSpacing: "0.08em",
        opacity: 0.75 + beat * 0.15,
        textShadow: `0 0 12px ${theme.violet}`,
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: theme.pink,
          boxShadow: `0 0 ${8 + beat * 12}px ${theme.pink}`,
        }}
      />
      Nic Vandewetering
    </div>
  );
};
