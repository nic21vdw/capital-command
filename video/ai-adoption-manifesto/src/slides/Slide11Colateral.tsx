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
import { GlowText, Kicker } from "../components/GlowText";
import { SlideChrome } from "../components/SlideChrome";
import { FONT_FAMILY } from "../fonts";
import { SCRIPT } from "../data/script";

/**
 * Slide 11 — PROOF OF INTENT.
 * CoLateral is product one. Includes the "Built on Fable 5" badge and a
 * "01 → ∞" product-line motif to signal it's the first of many.
 */
export const Slide11Colateral: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const copy = SCRIPT.slide11Colateral;

  const kickerIn = interpolate(frame, [4, 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const headlineIn = spring({
    frame: frame - sec(0.5),
    fps,
    config: { damping: 15, mass: 0.8, stiffness: 110 },
  });

  const badgeIn = spring({
    frame: frame - sec(2),
    fps,
    config: { damping: 12, mass: 0.7, stiffness: 130 },
  });

  return (
    <AbsoluteFill>
      <Background bloom={COLORS.accent} />
      <NodeField count={28} color={COLORS.accent} opacity={0.2} seedOffset={11} />

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ marginBottom: 28, opacity: kickerIn }}>
            <Kicker color={COLORS.accent}>{copy.kicker ?? ""}</Kicker>
          </div>

          <div
            style={{
              opacity: headlineIn,
              transform: `translateY(${interpolate(headlineIn, [0, 1], [40, 0])}px)`,
              marginBottom: 44,
            }}
          >
            <GlowText fontSize={104} glowStrength={0.9}>
              {copy.headline}
            </GlowText>
          </div>

          {/* Built on Fable 5 badge */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 16,
              opacity: badgeIn,
              transform: `scale(${interpolate(badgeIn, [0, 1], [0.7, 1])})`,
              padding: "16px 34px",
              borderRadius: 999,
              background: `linear-gradient(90deg, ${hexA(
                COLORS.accent,
                0.22,
              )}, ${hexA(COLORS.accentAlt, 0.22)})`,
              border: `1.5px solid ${hexA(COLORS.accentAlt, 0.7)}`,
              boxShadow: `0 0 32px ${hexA(COLORS.accentAlt, 0.4)}`,
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                background: COLORS.growth,
                boxShadow: `0 0 12px ${COLORS.growth}`,
              }}
            />
            <span
              style={{
                fontFamily: FONT_FAMILY,
                fontWeight: FONT.weightBold,
                fontSize: 32,
                letterSpacing: FONT.letterSpacingWide,
                textTransform: "uppercase",
                color: COLORS.foreground,
              }}
            >
              {BRAND.builtOn}
            </span>
          </div>

          {/* 01 → ∞ product-line motif */}
          <div
            style={{
              marginTop: 40,
              opacity: badgeIn * 0.9,
              fontFamily: FONT_FAMILY,
              fontWeight: FONT.weightBlack,
              fontSize: 40,
              letterSpacing: "0.3em",
              color: hexA(COLORS.foreground, 0.6),
            }}
          >
            01&nbsp;&nbsp;→&nbsp;&nbsp;∞
          </div>
        </div>
      </AbsoluteFill>

      <SlideChrome act={copy.act} slideId={copy.id} accentColor={COLORS.accent} />
    </AbsoluteFill>
  );
};
