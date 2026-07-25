import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Beamy } from "../components/Beamy";
import { HeroMark } from "../components/HeroMark";
import { Wordmark, WORD } from "../components/Wordmark";
import { Eyebrow, Tagline, Trustline } from "../components/Type";
import { copy } from "../theme";

/**
 * Reveal 5 — "Typeset" (6s). The restrained, most corporate cut: the live hero,
 * animated.
 *
 * This mirrors `index.html`'s hero stack and its CSS entrance order exactly —
 * logo, eyebrow, wordmark, tagline, trustline — so cutting from this clip to a
 * screen recording of the real site is seamless. The only flourish is the
 * kerning settle: letters spawn spread wide and un-blurred, then draw into the
 * wordmark's true -0.055em tracking. Beamy is perched beside the mark on his
 * slow hover, exactly as `beamy--home` does on the page.
 */

const CENTER = (WORD.length - 1) / 2;

export const RevealTypeset: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // entrance order matches the site's CSS animation delays, slowed ~2x for B-roll
  const logo = spring({ frame: frame - 8, fps, config: { damping: 18 } });
  const eyebrow = spring({ frame: frame - 26, fps, config: { damping: 18 } });
  const tagline = spring({ frame: frame - 92, fps, config: { damping: 18 } });
  const trust = spring({ frame: frame - 112, fps, config: { damping: 18 } });
  const beamy = spring({ frame: frame - 122, fps, config: { damping: 13, mass: 0.7 } });

  const draw = interpolate(frame, [8, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // letters spawn from a wide spread and settle into true kerning
  const styleFor = (i: number) => {
    const s = spring({
      frame: frame - 44 - i * 2,
      fps,
      config: { damping: 16, mass: 0.7 },
    });
    return {
      opacity: s,
      transform: `translateX(${(i - CENTER) * 34 * (1 - s)}px) translateY(${interpolate(
        s,
        [0, 1],
        [22, 0],
      )}px)`,
      filter: `blur(${interpolate(s, [0, 1], [14, 0])}px)`,
    };
  };

  return (
    <AbsoluteFill>
      <Backdrop grid={0.5} glow={0.9} />

      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center", flexDirection: "column" }}
      >
        {/* logo + perched Beamy, as on the homepage */}
        <div style={{ position: "relative", marginBottom: 26 }}>
          <div
            style={{
              opacity: logo,
              transform: `scale(${interpolate(logo, [0, 1], [0.82, 1])}) translateY(${interpolate(
                logo,
                [0, 1],
                [8, 0],
              )}px)`,
            }}
          >
            <HeroMark size={112} draw={draw} />
          </div>

          <div
            style={{
              position: "absolute",
              left: 128,
              top: -6,
              opacity: beamy,
              transform: `scale(${interpolate(beamy, [0, 1], [0.5, 1])})`,
              transformOrigin: "bottom left",
            }}
          >
            <Beamy size={104} mood="happy" phase={40} />
          </div>
        </div>

        <Eyebrow
          fontSize={25}
          style={{
            opacity: eyebrow,
            transform: `translateY(${interpolate(eyebrow, [0, 1], [18, 0])}px)`,
          }}
        >
          {copy.eyebrow}
        </Eyebrow>

        <div style={{ marginTop: 24 }}>
          <Wordmark fontSize={190} styleFor={styleFor} />
        </div>

        <Tagline
          fontSize={30}
          style={{
            marginTop: 30,
            opacity: tagline,
            transform: `translateY(${interpolate(tagline, [0, 1], [18, 0])}px)`,
          }}
        >
          {copy.tagline}
        </Tagline>

        <Trustline
          fontSize={20}
          style={{
            marginTop: 40,
            opacity: trust,
            transform: `translateY(${interpolate(trust, [0, 1], [14, 0])}px)`,
          }}
        >
          {copy.trustline}
        </Trustline>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
