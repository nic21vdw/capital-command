import React from "react";
import { fontFamily, theme } from "../theme";

export const Signature: React.FC = () => {
  return (
    <div
      style={{
        position: "absolute",
        right: 48,
        bottom: 36,
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily,
        color: theme.muted,
        fontSize: 15,
        letterSpacing: "0.04em",
        opacity: 0.85,
      }}
    >
      <svg width={18} height={18} viewBox="0 0 18 18">
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i * 45 * Math.PI) / 180;
          const cx = 9;
          const cy = 9;
          return (
            <line
              key={i}
              x1={cx + Math.cos(a) * 2}
              y1={cy + Math.sin(a) * 2}
              x2={cx + Math.cos(a) * 8}
              y2={cy + Math.sin(a) * 8}
              stroke={theme.pink}
              strokeWidth={1.4}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      Nic Vandewetering
    </div>
  );
};
