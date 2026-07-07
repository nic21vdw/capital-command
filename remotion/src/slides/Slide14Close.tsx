import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { BRAND, COLORS, hexA, sec, FONT } from "../config";
import { Background } from "../components/Background";
import { NodeField } from "../components/NodeField";
import { ImpactText } from "../components/ImpactText";
import { GlowText } from "../components/GlowText";
import { FONT_FAMILY } from "../fonts";
import { SCRIPT } from "../data/script";

/**
 * Slide 14 — THE CLOSE.
 * "We're not building a business." lands quiet, "WE'RE BUILDING AN EMPIRE."
 * slams in, the whole network converges bright, then the brand mark resolves.
 */
export const Slide14Close: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const copy = SCRIPT.slide14Close;

  const line1Start = sec(0.4);
  const slamStart = sec(1.8);
  const brandStart = sec(6.5);

  const line1In = interpolate(
    frame,
    [line1Start, line1Start + 16],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Network intensifies toward the empire line.
  const converge = interpolate(frame, [slamStart, slamStart + sec(2)], [0.5, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const brandIn = spring({
    frame: frame - brandStart,
    fps,
    config: { damping: 16, mass: 0.9, stiffness: 90 },
  });

  // Everything above the brand eases up/out as the brand resolves.
  const manifestoOut = interpolate(
    frame,
    [brandStart - 6, brandStart + 14],
    [1, 0.12],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill>
      <Background bloom={COLORS.accentAlt} />
      <NodeField
        count={54}
        color={COLORS.accent}
        lineColor={COLORS.accentAlt}
        opacity={0.28 + 0.35 * converge}
        linkDistance={200 + 120 * converge}
        build={1}
        seedOffset={14}
      />

      {/* Manifesto lines */}
      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center" }}
      >
        <div style={{ textAlign: "center", opacity: manifestoOut }}>
          <div
            style={{
              opacity: line1In,
              transform: `translateY(${(1 - line1In) * 16}px)`,
              marginBottom: 34,
            }}
          >
            <GlowText fontSize={74} glowStrength={0.5}>
              We're not building a business.
            </GlowText>
          </div>

          <ImpactText
            startFrame={slamStart}
            color={COLORS.accentAlt}
            fontSize={138}
          >
            {"WE'RE BUILDING\nAN EMPIRE."}
          </ImpactText>
        </div>
      </AbsoluteFill>

      {/* Brand resolve */}
      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center" }}
      >
        <div
          style={{
            textAlign: "center",
            opacity: brandIn,
            transform: `scale(${interpolate(brandIn, [0, 1], [0.9, 1])})`,
          }}
        >
          <div
            style={{
              fontFamily: FONT_FAMILY,
              fontWeight: FONT.weightBlack,
              fontSize: 108,
              letterSpacing: "0.16em",
              color: COLORS.foreground,
              textShadow: `0 0 40px ${hexA(COLORS.accent, 0.7)}`,
            }}
          >
            {BRAND.name}
          </div>
          <div
            style={{
              marginTop: 24,
              fontFamily: FONT_FAMILY,
              fontWeight: FONT.weightBold,
              fontSize: 30,
              letterSpacing: FONT.letterSpacingWide,
              textTransform: "uppercase",
              color: COLORS.accentAlt,
              textShadow: `0 0 18px ${hexA(COLORS.accentAlt, 0.6)}`,
            }}
          >
            {BRAND.product} — {BRAND.builtOn}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
