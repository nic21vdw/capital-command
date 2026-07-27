import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOR_BG, COLOR_PRIMARY, COLOR_TEXT, FONT_FAMILY, WEIGHT } from "../theme";

export type SeriesLogoProps = {
  /** Wordmark text. Defaults to the series name. */
  title?: string;
  /** Icon/accent colour. Defaults to the primary orange-red. */
  accent?: string;
};

/**
 * Standalone, reusable series logo card: an SVG "spark in a rounded square"
 * mark next to the wordmark. Fades + springs in, holds, fades out (exit keyed
 * to the Sequence duration). Drop it into every future episode.
 */
export const SeriesLogo: React.FC<SeriesLogoProps> = ({ title = "FREE AI BUILDS", accent = COLOR_PRIMARY }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 14, mass: 0.8 } });
  const fadeOut = interpolate(frame, [durationInFrames - 16, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  const scale = interpolate(enter, [0, 1], [0.7, 1]);
  const opacity = Math.min(enter, fadeOut);

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", fontFamily: FONT_FAMILY }}>
      <div style={{ display: "flex", alignItems: "center", gap: 34, transform: `scale(${scale})`, opacity }}>
        {/* SVG mark: rounded square with a spark/plus, in the accent colour */}
        <svg width={140} height={140} viewBox="0 0 140 140" role="img" aria-label="logo mark">
          <rect x={10} y={10} width={120} height={120} rx={34} fill={accent} />
          {/* plus, knocked out in the background colour */}
          <rect x={62} y={34} width={16} height={72} rx={8} fill={COLOR_BG} />
          <rect x={34} y={62} width={72} height={16} rx={8} fill={COLOR_BG} />
          {/* small diagonal spark accents */}
          <rect x={95} y={30} width={9} height={24} rx={4.5} fill={COLOR_BG} transform="rotate(45 99 42)" />
        </svg>
        <div style={{ fontSize: 88, fontWeight: WEIGHT.black, color: COLOR_TEXT, letterSpacing: 1, lineHeight: 1 }}>
          {title}
        </div>
      </div>
    </AbsoluteFill>
  );
};
