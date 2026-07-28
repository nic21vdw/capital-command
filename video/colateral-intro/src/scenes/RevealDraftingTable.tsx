import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Beamy } from "../components/Beamy";
import { HeroMark } from "../components/HeroMark";
import { Wordmark } from "../components/Wordmark";
import { Eyebrow, Tagline } from "../components/Type";
import { theme, copy } from "../theme";

/**
 * Reveal 1 — "Drafting Table" (6s). Calm, premium, the safest cold open.
 *
 * The logo mark draws itself on like a CAD line, the eyebrow rises, the
 * wordmark's letters spawn in sequence with a hairline rule underneath, and
 * Beamy walks in from the left and tips a wave. Nothing shouts; it just
 * assembles.
 */
export const RevealDraftingTable: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // mark draws itself in over ~30 frames
  const draw = interpolate(frame, [8, 44], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const eyebrow = spring({ frame: frame - 44, fps, config: { damping: 18 } });

  // letters spawn one by one: rise + un-blur, 2.5 frames apart
  const styleFor = (i: number) => {
    const s = spring({
      frame: frame - 56 - i * 2.5,
      fps,
      config: { damping: 14, mass: 0.55 },
    });
    return {
      opacity: s,
      transform: `translateY(${interpolate(s, [0, 1], [40, 0])}px)`,
      filter: `blur(${interpolate(s, [0, 1], [10, 0])}px)`,
    };
  };

  // hairline rule draws left→right beneath the mark
  const rule = spring({ frame: frame - 84, fps, config: { damping: 20 } });
  const tagline = spring({ frame: frame - 96, fps, config: { damping: 18 } });

  // Beamy walks in from the left and settles
  const walk = spring({ frame: frame - 68, fps, config: { damping: 16, mass: 0.9 } });
  const beamyX = interpolate(walk, [0, 1], [-360, 0]);

  return (
    <AbsoluteFill>
      <Backdrop grid={0.7} />

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          gap: 0,
        }}
      >
        <div style={{ marginBottom: 30 }}>
          <HeroMark size={104} draw={draw} />
        </div>

        <Eyebrow
          fontSize={25}
          style={{
            opacity: eyebrow,
            transform: `translateY(${interpolate(eyebrow, [0, 1], [16, 0])}px)`,
          }}
        >
          {copy.eyebrow}
        </Eyebrow>

        {/* wordmark + Beamy share a row so he reads as standing beside the mark */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 72,
            marginTop: 22,
          }}
        >
          <div
            style={{
              opacity: walk,
              transform: `translateX(${beamyX}px)`,
              marginBottom: 6,
            }}
          >
            <Beamy size={172} mood="happy" waveFrom={112} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <Wordmark fontSize={168} styleFor={styleFor} />
            <div
              style={{
                width: 812,
                height: 2,
                marginTop: 26,
                transformOrigin: "left center",
                transform: `scaleX(${rule})`,
                background: `linear-gradient(90deg, ${theme.brand}, rgba(181,128,255,0))`,
              }}
            />
          </div>
        </div>

        <Tagline
          fontSize={29}
          style={{
            marginTop: 34,
            opacity: tagline,
            transform: `translateY(${interpolate(tagline, [0, 1], [18, 0])}px)`,
          }}
        >
          {copy.tagline}
        </Tagline>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
