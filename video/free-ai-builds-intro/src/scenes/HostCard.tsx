import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { GlowBackground } from "../components/GlowBackground";
import { LowerThird } from "../components/LowerThird";
import { theme, fontFamily } from "../theme";

/**
 * Host intro card. In the final edit this is where direct-to-camera footage
 * would sit; here it stands alone with the reusable LowerThird over the glow.
 */
export const HostCard: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 18 } });

  return (
    <AbsoluteFill>
      <GlowBackground color={theme.highlight} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            fontFamily,
            fontWeight: 700,
            fontSize: 44,
            color: theme.muted,
            opacity: enter,
            transform: `translateY(${interpolate(enter, [0, 1], [-20, 0])}px)`,
            textAlign: "center",
            maxWidth: 820,
            lineHeight: 1.3,
          }}
        >
          I build with AI every day.
          <br />
          Now I&apos;m building for{" "}
          <span style={{ color: theme.accent }}>you</span>.
        </div>
      </AbsoluteFill>
      <LowerThird
        name="Nic Vandewetering"
        subtitle="Structural Engineer · Building CoLateral"
        durationInFrames={durationInFrames}
      />
    </AbsoluteFill>
  );
};
