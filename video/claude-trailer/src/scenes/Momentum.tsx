import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { ClaudeSpark } from "../components/ClaudeSpark";
import { theme, serifFamily, VIDEO } from "../theme";

/**
 * Kinetic beat (3s): "Think deeper." then "Ship faster." punch in, while a
 * spark comet sweeps across the frame under the type — pure momentum before
 * the end card.
 */
export const Momentum: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const line1 = spring({ frame, fps, config: { damping: 12, mass: 0.7 } });
  const line2 = spring({ frame: frame - 22, fps, config: { damping: 12, mass: 0.7 } });

  // spark comet: eased left-to-right pass with a fading trail
  const sweep = interpolate(frame, [16, 74], [-200, VIDEO.width + 200], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <Backdrop />

      <div
        style={{
          fontFamily: serifFamily,
          fontWeight: 600,
          fontSize: 158,
          letterSpacing: -2,
          color: theme.ivory,
          opacity: line1,
          transform: `scale(${interpolate(line1, [0, 1], [1.35, 1])})`,
          lineHeight: 1.05,
        }}
      >
        Think deeper.
      </div>
      <div
        style={{
          fontFamily: serifFamily,
          fontWeight: 600,
          fontSize: 158,
          letterSpacing: -2,
          color: theme.accent,
          opacity: line2,
          transform: `scale(${interpolate(line2, [0, 1], [1.35, 1])})`,
          lineHeight: 1.05,
        }}
      >
        Ship faster.
      </div>

      <div style={{ position: "absolute", top: "76%", left: 0, right: 0, height: 80 }}>
        {[0, 1, 2, 3].map((t) => (
          <div key={t} style={{ position: "absolute", left: sweep - t * 64, top: t * 3 }}>
            <ClaudeSpark
              size={56 - t * 10}
              rotation={frame * 5}
              opacity={interpolate(t, [0, 3], [0.9, 0.12])}
            />
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
