import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { theme, fontFamily } from "../theme";

/** One "job → model" row that slides in on its own delay. */
const PickRow: React.FC<{
  job: string;
  model: string;
  color: string;
  delay: number;
}> = ({ job, model, color, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 15 } });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        borderRadius: 24,
        backgroundColor: "rgba(255,255,255,0.05)",
        border: `3px solid ${color}`,
        padding: "38px 44px",
        opacity: s,
        transform: `translateX(${interpolate(s, [0, 1], [90, 0])}px)`,
      }}
    >
      <div style={{ fontFamily, fontWeight: 700, fontSize: 46, color: theme.text }}>{job}</div>
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 40,
          letterSpacing: 2,
          color: theme.bg,
          backgroundColor: color,
          borderRadius: 999,
          padding: "12px 32px",
          whiteSpace: "nowrap",
        }}
      >
        {model}
      </div>
    </div>
  );
};

/**
 * How to actually choose: match the model to the job, not the hype. Three
 * job → model rows land in sequence, then the rule of thumb stamps the point.
 */
export const ModelPicker: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const header = spring({ frame, fps, config: { damping: 16 } });
  const rule = spring({ frame: frame - 130, fps, config: { damping: 13 } });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.bg,
        justifyContent: "center",
        alignItems: "center",
        padding: "0 80px",
        gap: 40,
      }}
    >
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 62,
          color: theme.text,
          textAlign: "center",
          opacity: header,
          transform: `translateY(${interpolate(header, [0, 1], [30, 0])}px)`,
          marginBottom: 12,
        }}
      >
        Match the model to the job
      </div>
      <PickRow job="Quick everyday tasks" model="FAST & CHEAP" color={theme.highlight} delay={30} />
      <PickRow job="Real work, most days" model="BALANCED" color={theme.accent} delay={62} />
      <PickRow job="The hard problems" model="BIG BRAIN" color={theme.reveal} delay={94} />
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 58,
          color: theme.reveal,
          textAlign: "center",
          marginTop: 16,
          opacity: rule,
          transform: `scale(${interpolate(rule, [0, 1], [0.85, 1])})`,
        }}
      >
        Right tool. Right job. Every time.
      </div>
    </AbsoluteFill>
  );
};
