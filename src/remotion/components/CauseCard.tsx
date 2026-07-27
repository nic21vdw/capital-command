import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { LucideIcon } from "lucide-react";
import { colors, fonts, shadow, type, withAlpha } from "../theme";

export type CauseCardProps = {
  icon: LucideIcon;
  index: number;
  total: number;
  heading: string;
  line: string;
  /** Accent colour token value (from theme.colors). */
  accent: string;
};

/**
 * Reusable "likely cause" card: numbered accent, icon, heading and one line.
 * Animates in on its own local frame so it can live inside a <Sequence>.
 */
export const CauseCard: React.FC<CauseCardProps> = ({ icon: Icon, index, total, heading, line, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 18, mass: 0.9 }, durationInFrames: 26 });
  const y = interpolate(enter, [0, 1], [70, 0]);
  const iconPop = spring({ frame: frame - 6, fps, config: { damping: 12, mass: 0.7 }, durationInFrames: 22 });

  return (
    <div
      style={{
        width: 1180,
        display: "flex",
        alignItems: "center",
        gap: 40,
        padding: "48px 56px",
        borderRadius: 28,
        background: colors.surface,
        border: `1px solid ${withAlpha("comment", 0.4)}`,
        borderLeft: `10px solid ${accent}`,
        boxShadow: shadow.card,
        opacity: enter,
        transform: `translateY(${y}px)`,
        fontFamily: fonts.family
      }}
    >
      {/* icon medallion */}
      <div
        style={{
          flex: "0 0 auto",
          width: 130,
          height: 130,
          borderRadius: 26,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: withAlpha(
            // map the accent back to a token-ish tint via a fixed light wash
            "foreground",
            0.04
          ),
          border: `2px solid ${accent}`,
          transform: `scale(${iconPop})`,
          boxShadow: `0 0 28px ${withAlpha("purple", 0.25)}`
        }}
      >
        <Icon size={70} color={accent} strokeWidth={2.2} />
      </div>

      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: type.label,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: colors.comment,
            fontWeight: fonts.weight.semibold,
            marginBottom: 10
          }}
        >
          Likely cause {index} of {total}
        </div>
        <div
          style={{
            fontSize: type.heading,
            fontWeight: fonts.weight.black,
            color: colors.foreground,
            lineHeight: 1.05
          }}
        >
          {heading}
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: type.body,
            fontWeight: fonts.weight.regular,
            color: colors.comment,
            lineHeight: 1.35,
            maxWidth: 820
          }}
        >
          {line}
        </div>
      </div>
    </div>
  );
};
