import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { theme, fontFamily } from "../theme";

/** One era card: year chip + what that revolution replaced. */
const EraCard: React.FC<{
  era: string;
  headline: string;
  detail: string;
  color: string;
  delay: number;
}> = ({ era, headline, detail, color, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 15 } });

  return (
    <div
      style={{
        width: "100%",
        borderRadius: 28,
        border: `3px solid ${color}`,
        backgroundColor: "rgba(255,255,255,0.04)",
        padding: "44px 48px",
        opacity: s,
        transform: `translateX(${interpolate(s, [0, 1], [-70, 0])}px)`,
      }}
    >
      <div style={{ fontFamily, fontWeight: 800, fontSize: 40, letterSpacing: 6, color }}>{era}</div>
      <div style={{ fontFamily, fontWeight: 800, fontSize: 76, color: theme.text, lineHeight: 1.1, marginTop: 12 }}>
        {headline}
      </div>
      <div style={{ fontFamily, fontWeight: 600, fontSize: 42, color: theme.muted, marginTop: 14, lineHeight: 1.3 }}>
        {detail}
      </div>
    </div>
  );
};

/**
 * The comparison that earns the hook: steam mechanized muscle, AI mechanizes
 * thinking. Two era cards slide in, then the "same shift, new century" line
 * lands underneath.
 */
export const ThenVsNow: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const punch = spring({ frame: frame - 105, fps, config: { damping: 14 } });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.bg,
        justifyContent: "center",
        alignItems: "center",
        padding: "0 80px",
        gap: 48,
      }}
    >
      <EraCard
        era="1800s"
        headline="Steam powered muscle"
        detail="Machines did the lifting — everything changed"
        color={theme.highlight}
        delay={0}
      />
      <EraCard
        era="TODAY"
        headline="AI powers thinking"
        detail="Models do the brainwork — everything changes again"
        color={theme.reveal}
        delay={45}
      />
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 64,
          color: theme.accent,
          textAlign: "center",
          opacity: punch,
          transform: `scale(${interpolate(punch, [0, 1], [0.85, 1])})`,
        }}
      >
        Same shift. New century.
      </div>
    </AbsoluteFill>
  );
};
