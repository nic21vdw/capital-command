import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, SAFE_MARGIN, type, withAlpha } from "../theme";

export type TitleCardProps = {
  kicker: string;
  title: string;
  subtitle: string;
};

/**
 * Animated title reveal with a purple underline that wipes in left-to-right.
 * Everything is driven by springs so nothing snaps.
 */
export const TitleCard: React.FC<TitleCardProps> = ({ kicker, title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const kickerIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 20 });
  const titleIn = spring({ frame: frame - 8, fps, config: { damping: 200 }, durationInFrames: 26 });
  const subtitleIn = spring({ frame: frame - 22, fps, config: { damping: 200 }, durationInFrames: 24 });

  // Underline wipe: scaleX 0 -> 1 from the left, springs in after the title.
  const underline = spring({ frame: frame - 26, fps, config: { damping: 200 }, durationInFrames: 26 });

  const titleY = interpolate(titleIn, [0, 1], [40, 0]);
  const subtitleY = interpolate(subtitleIn, [0, 1], [24, 0]);
  const kickerY = interpolate(kickerIn, [0, 1], [18, 0]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        paddingLeft: SAFE_MARGIN + 40,
        paddingRight: SAFE_MARGIN,
        fontFamily: fonts.family
      }}
    >
      <div
        style={{
          textTransform: "uppercase",
          letterSpacing: 8,
          fontSize: type.label,
          fontWeight: fonts.weight.semibold,
          color: colors.cyan,
          opacity: kickerIn,
          transform: `translateY(${kickerY}px)`,
          marginBottom: 24
        }}
      >
        {kicker}
      </div>

      <div style={{ position: "relative", display: "inline-block" }}>
        <h1
          style={{
            margin: 0,
            fontSize: type.title,
            lineHeight: 1.02,
            fontWeight: fonts.weight.black,
            color: colors.foreground,
            opacity: titleIn,
            transform: `translateY(${titleY}px)`,
            maxWidth: 1400
          }}
        >
          {title}
        </h1>

        {/* Purple underline wipe. */}
        <div
          style={{
            marginTop: 22,
            height: 10,
            borderRadius: 6,
            width: 620,
            maxWidth: "80%",
            background: `linear-gradient(90deg, ${colors.purple}, ${colors.pink})`,
            transform: `scaleX(${underline})`,
            transformOrigin: "left center",
            boxShadow: `0 0 24px ${withAlpha("purple", 0.55)}`
          }}
        />
      </div>

      <div
        style={{
          marginTop: 30,
          fontSize: type.subheading,
          fontWeight: fonts.weight.regular,
          color: colors.comment,
          opacity: subtitleIn,
          transform: `translateY(${subtitleY}px)`,
          maxWidth: 1200
        }}
      >
        {subtitle}
      </div>
    </AbsoluteFill>
  );
};
