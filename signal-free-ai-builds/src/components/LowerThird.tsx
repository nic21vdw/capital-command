import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOR_BG, COLOR_MUTED, COLOR_PRIMARY, COLOR_TEXT, FONT_FAMILY, WEIGHT } from "../theme";

export type LowerThirdProps = {
  /** Primary line — a name. */
  name: string;
  /** Secondary line — a title/credential, shown smaller and muted. */
  subtitle: string;
  /** How many frames before the end to begin sliding out. */
  exitFrames?: number;
};

/**
 * Reusable lower-third name/title card. Slides in from the left, holds, then
 * slides back out. Pass `name`/`subtitle` to reuse it across every episode.
 *
 * Exit timing keys off the Sequence's own `durationInFrames`, so it always
 * leaves cleanly however long you place it in the timeline.
 */
export const LowerThird: React.FC<LowerThirdProps> = ({ name, subtitle, exitFrames = 22 }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 18, mass: 0.9 }, durationInFrames: 22 });
  const exit = spring({ frame: frame - (durationInFrames - exitFrames), fps, config: { damping: 18 }, durationInFrames: exitFrames });

  const x = interpolate(enter, [0, 1], [-720, 0]) + interpolate(exit, [0, 1], [0, -820]);
  const opacity = Math.max(0, interpolate(enter, [0, 1], [0, 1]) - interpolate(exit, [0, 1], [0, 1]));

  return (
    <AbsoluteFill style={{ fontFamily: FONT_FAMILY }}>
      <div
        style={{
          position: "absolute",
          left: 90,
          bottom: 320,
          display: "flex",
          transform: `translateX(${x}px)`,
          opacity,
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.55)"
        }}
      >
        {/* orange-red left accent stripe */}
        <div style={{ width: 12, background: COLOR_PRIMARY, borderRadius: "6px 0 0 6px" }} />
        <div
          style={{
            background: COLOR_BG,
            padding: "28px 44px 30px 36px",
            borderRadius: "0 10px 10px 0"
          }}
        >
          <div style={{ fontSize: 62, fontWeight: WEIGHT.extrabold, color: COLOR_TEXT, lineHeight: 1.05, letterSpacing: 0.5 }}>
            {name}
          </div>
          <div style={{ marginTop: 10, fontSize: 34, fontWeight: WEIGHT.medium, color: COLOR_MUTED, letterSpacing: 0.5 }}>
            {subtitle}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
