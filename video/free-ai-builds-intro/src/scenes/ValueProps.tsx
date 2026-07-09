import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { theme, fontFamily } from "../theme";

const ROWS = [
  { k: "01", t: "A real person, a real problem" },
  { k: "02", t: "I build them a tool with AI" },
  { k: "03", t: "You watch the whole thing" },
];

/** Three staggered value-prop rows sliding in from the left. */
export const ValueProps: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.bg,
        justifyContent: "center",
        paddingLeft: 130,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 54 }}>
        {ROWS.map((r, i) => {
          const s = spring({ frame: frame - i * 18, fps, config: { damping: 16 } });
          const x = interpolate(s, [0, 1], [-80, 0]);
          return (
            <div
              key={r.k}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 36,
                transform: `translateX(${x}px)`,
                opacity: s,
              }}
            >
              <span
                style={{
                  fontFamily,
                  fontWeight: 800,
                  fontSize: 60,
                  color: theme.accent,
                }}
              >
                {r.k}
              </span>
              <span
                style={{
                  fontFamily,
                  fontWeight: 700,
                  fontSize: 62,
                  color: theme.text,
                  maxWidth: 760,
                }}
              >
                {r.t}
              </span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
