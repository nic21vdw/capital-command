import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, SAFE_MARGIN, shadow, type, withAlpha } from "../theme";

export type LowerThirdProps = {
  name: string;
  credential: string;
  /** Frame (relative to this component) at which it begins sliding in. */
  delay?: number;
};

/**
 * Bottom-left name / credential lower third. Slides in from the left on a
 * spring, sits inside the 80px safe margin.
 */
export const LowerThird: React.FC<LowerThirdProps> = ({ name, credential, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 26 });
  const x = interpolate(enter, [0, 1], [-160, 0]);
  const barGrow = spring({ frame: frame - delay - 4, fps, config: { damping: 200 }, durationInFrames: 22 });

  return (
    <div
      style={{
        position: "absolute",
        left: SAFE_MARGIN,
        bottom: SAFE_MARGIN,
        display: "flex",
        alignItems: "stretch",
        gap: 20,
        opacity: enter,
        transform: `translateX(${x}px)`,
        fontFamily: fonts.family
      }}
    >
      {/* Purple accent bar that grows vertically. */}
      <div
        style={{
          width: 8,
          borderRadius: 4,
          background: `linear-gradient(180deg, ${colors.purple}, ${colors.pink})`,
          transform: `scaleY(${barGrow})`,
          transformOrigin: "top center",
          boxShadow: `0 0 18px ${withAlpha("purple", 0.5)}`
        }}
      />
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${withAlpha("comment", 0.4)}`,
          borderRadius: 14,
          padding: "18px 30px",
          boxShadow: shadow.soft
        }}
      >
        <div
          style={{
            fontSize: type.subheading,
            fontWeight: fonts.weight.black,
            color: colors.foreground,
            lineHeight: 1.1
          }}
        >
          {name}
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: type.label,
            fontWeight: fonts.weight.semibold,
            color: colors.comment,
            letterSpacing: 0.5
          }}
        >
          {credential}
        </div>
      </div>
    </div>
  );
};
