import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  Sequence,
} from "remotion";
import { COLORS, sec, hexA, FONT } from "../config";
import { Background } from "../components/Background";
import { NodeField } from "../components/NodeField";
import { GlitchSwap } from "../components/TypeOnText";
import { GlowText } from "../components/GlowText";
import { FONT_FAMILY } from "../fonts";
import { SCRIPT } from "../data/script";

/**
 * Slide 01 — THE HOOK.
 * Near-black open, "1995." then a glitch-cut to "2026." with a pink
 * chromatic flicker, then the personal-stakes subtitle rises.
 */
export const Slide01Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const copy = SCRIPT.slide01Hook;

  const swapFrame = sec(3);

  // Background stays near-black until the swap, then the field blooms in.
  const bgReveal = interpolate(frame, [swapFrame, swapFrame + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Subtitle rises after the year lands.
  const subStart = sec(4);
  const subIn = interpolate(frame, [subStart, subStart + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: "#050506" }}>
      <div style={{ opacity: bgReveal }}>
        <Background bloom={COLORS.accent} />
        <NodeField
          count={34}
          color={COLORS.accent}
          opacity={0.22 * bgReveal}
          build={bgReveal}
          seedOffset={1}
        />
      </div>

      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center" }}
      >
        <div style={{ width: "100%" }}>
          <GlitchSwap from="1995." to="2026." swapFrame={swapFrame} fontSize={340} />

          <Sequence from={subStart}>
            <div
              style={{
                marginTop: 40,
                opacity: subIn,
                transform: `translateY(${(1 - subIn) * 22}px)`,
                textAlign: "center",
                padding: "0 200px",
              }}
            >
              <GlowText
                color={COLORS.foreground}
                fontSize={52}
                weight={FONT.weightMedium}
                glowStrength={0.4}
                lineHeight={1.2}
              >
                {"They laughed at the internet.\nNow they're booing AI off the stage."}
              </GlowText>
            </div>
          </Sequence>
        </div>
      </AbsoluteFill>

      {/* tiny "the same mistake, twice" footer tag */}
      <div
        style={{
          position: "absolute",
          bottom: 60,
          width: "100%",
          textAlign: "center",
          opacity: subIn * 0.8,
          fontFamily: FONT_FAMILY,
          fontWeight: FONT.weightBold,
          fontSize: 22,
          letterSpacing: FONT.letterSpacingWide,
          textTransform: "uppercase",
          color: hexA(COLORS.accentAlt, 0.9),
          textShadow: `0 0 14px ${hexA(COLORS.accentAlt, 0.6)}`,
        }}
      >
        The same mistake — twice
      </div>
    </AbsoluteFill>
  );
};
