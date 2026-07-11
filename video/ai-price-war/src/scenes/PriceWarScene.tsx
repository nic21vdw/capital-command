import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOR_BG, COLOR_MUTED, COLOR_PRIMARY, COLOR_SECONDARY, FONT_FAMILY, WEIGHT, withAlpha } from "../theme";

// VO timing (scene runs 0:05–0:12 of the B-roll block):
//   "Because this stopped being about who's smartest…
//    it's now about who's cheapest per token."
// The fracture hits at ~0:06 (frame 30 of this scene) — land it on
// "stopped". Captions fade in under the numbers for the "per token" line.

const FRACTURE_FRAME = 30; // when the price tag splits
const FRACTURE_GAP = 90; // px each side travels away from centre

/**
 * Scene 2 · 7s (210f). "$2 vs $10" in yellow; a vertical fracture splits the
 * two prices apart with a 2–3px screen shake and an orange-red glow pulse.
 * Captions ("Grok 4.5 output" / "Fable 5 output") fade in beneath.
 */
export const PriceWarScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 14, mass: 0.8 } });

  // Fracture: springs the two sides apart, draws the crack line down centre.
  const fracture = spring({ frame: frame - FRACTURE_FRAME, fps, config: { damping: 11, mass: 0.9 } });
  const crackDraw = interpolate(frame, [FRACTURE_FRAME, FRACTURE_FRAME + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  // Subtle 2–3px screen shake on impact, decaying over ~20 frames. Driven off
  // sines of the frame so it's deterministic (no Math.random in Remotion).
  const shakeAmp = interpolate(frame, [FRACTURE_FRAME, FRACTURE_FRAME + 20], [3, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const shakeX = Math.sin(frame * 13.7) * shakeAmp;
  const shakeY = Math.cos(frame * 9.3) * shakeAmp;

  // Orange-red glow pulse behind the fracture point.
  const glow = interpolate(frame, [FRACTURE_FRAME, FRACTURE_FRAME + 8, FRACTURE_FRAME + 45], [0, 0.5, 0.15], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  const captionOpacity = interpolate(frame, [FRACTURE_FRAME + 25, FRACTURE_FRAME + 45], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLOR_BG,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: FONT_FAMILY,
        transform: `translate(${shakeX}px, ${shakeY}px)`
      }}
    >
      {/* Glow pulse at the fracture point. */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
        <div
          style={{
            width: 900,
            height: 900,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${COLOR_PRIMARY} 0%, transparent 65%)`,
            opacity: glow,
            filter: "blur(28px)"
          }}
        />
      </AbsoluteFill>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 48, opacity: enter }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 56 }}>
          {/* Left side of the fracture — travels left with a slight tilt. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 28,
              transform: `translateX(${-fracture * FRACTURE_GAP}px) rotate(${-fracture * 1.5}deg)`
            }}
          >
            <span style={{ fontSize: 260, fontWeight: WEIGHT.black, color: COLOR_SECONDARY, lineHeight: 1 }}>$2</span>
            <span style={{ fontSize: 30, fontWeight: WEIGHT.semibold, color: COLOR_MUTED, opacity: captionOpacity }}>
              Grok 4.5 output
            </span>
          </div>

          <span style={{ fontSize: 84, fontWeight: WEIGHT.bold, color: COLOR_MUTED, alignSelf: "center" }}>vs</span>

          {/* Right side — travels right, opposite tilt. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 28,
              transform: `translateX(${fracture * FRACTURE_GAP}px) rotate(${fracture * 1.5}deg)`
            }}
          >
            <span style={{ fontSize: 260, fontWeight: WEIGHT.black, color: COLOR_SECONDARY, lineHeight: 1 }}>$10</span>
            <span style={{ fontSize: 30, fontWeight: WEIGHT.semibold, color: COLOR_MUTED, opacity: captionOpacity }}>
              Fable 5 output
            </span>
          </div>
        </div>

        <span style={{ fontSize: 34, fontWeight: WEIGHT.semibold, color: COLOR_MUTED, letterSpacing: 4, opacity: captionOpacity }}>
          PER MILLION TOKENS
        </span>
      </div>

      {/* Jagged crack drawing down the centre on impact. */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
        <svg width={120} height={520} viewBox="0 0 120 520" style={{ marginBottom: 220 }}>
          <polyline
            points="60,0 48,75 76,140 52,215 70,290 44,365 68,440 58,520"
            fill="none"
            stroke={COLOR_PRIMARY}
            strokeWidth={7}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={700}
            strokeDashoffset={700 * (1 - crackDraw)}
            style={{ filter: `drop-shadow(0 0 12px ${withAlpha(COLOR_PRIMARY, 0.8)})` }}
          />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
