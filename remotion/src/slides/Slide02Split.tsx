import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { COLORS } from "../config";
import { SplitScreen } from "../components/SplitScreen";
import { GlowText, Kicker } from "../components/GlowText";
import { SlideChrome } from "../components/SlideChrome";
import { SCRIPT } from "../data/script";

/**
 * Slide 02 — THE RESISTANCE.
 * The split visual builds: muted turned-away crowd on the left vs. a glowing
 * network rising on the right. Copy sits low so the visual reads first.
 */
export const Slide02Split: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const copy = SCRIPT.slide02Split;

  const build = spring({
    frame,
    fps,
    config: { damping: 20, mass: 1.2, stiffness: 60 },
  });

  const textIn = interpolate(frame, [24, 42], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: COLORS.backgroundDeep }}>
      <SplitScreen build={build} />

      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 150,
        }}
      >
        <div
          style={{
            opacity: textIn,
            transform: `translateY(${(1 - textIn) * 26}px)`,
            textAlign: "center",
            maxWidth: 1300,
          }}
        >
          <div style={{ marginBottom: 22 }}>
            <Kicker color={COLORS.accentAlt}>{copy.kicker ?? ""}</Kicker>
          </div>
          <GlowText fontSize={86} glowStrength={0.8}>
            {copy.headline}
          </GlowText>
        </div>
      </AbsoluteFill>

      <SlideChrome act={copy.act} slideId={copy.id} accentColor={COLORS.accent} />
    </AbsoluteFill>
  );
};
