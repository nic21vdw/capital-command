import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { COLORS, sec } from "../config";
import { Background } from "../components/Background";
import { NodeField } from "../components/NodeField";
import { ImpactText } from "../components/ImpactText";
import { GlowText, Kicker } from "../components/GlowText";
import { SlideChrome } from "../components/SlideChrome";
import { SCRIPT } from "../data/script";

/**
 * Slide 04 — THE TRUTH (the reframe).
 * The strike line. "It doesn't erase work." lands quiet, then "IT REWRITES IT."
 * slams in in pink with a shake — the pivot of Act I.
 */
export const Slide04Reframe: React.FC = () => {
  const frame = useCurrentFrame();
  const copy = SCRIPT.slide04Reframe;

  const line1Start = sec(0.3);
  const slamStart = sec(1.6);

  const line1In = interpolate(
    frame,
    [line1Start, line1Start + 14],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill>
      <Background bloom={COLORS.accentAlt} />
      <NodeField
        count={24}
        color={COLORS.accentAlt}
        opacity={0.16}
        seedOffset={4}
      />

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ marginBottom: 30, opacity: line1In }}>
            <Kicker color={COLORS.accentAlt}>{copy.kicker ?? ""}</Kicker>
          </div>

          <div
            style={{
              opacity: line1In,
              transform: `translateY(${(1 - line1In) * 16}px)`,
              marginBottom: 30,
            }}
          >
            <GlowText fontSize={78} glowStrength={0.5} color={COLORS.foreground}>
              It doesn't erase work.
            </GlowText>
          </div>

          <ImpactText
            startFrame={slamStart}
            color={COLORS.accentAlt}
            fontSize={128}
          >
            IT REWRITES IT.
          </ImpactText>
        </div>
      </AbsoluteFill>

      <SlideChrome
        act={copy.act}
        slideId={copy.id}
        accentColor={COLORS.accentAlt}
      />
    </AbsoluteFill>
  );
};
