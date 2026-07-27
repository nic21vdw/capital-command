import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";
import { COLORS, hexA, sec, FONT } from "../config";
import { Background } from "../components/Background";
import { NodeField } from "../components/NodeField";
import { GlowText, Kicker } from "../components/GlowText";
import { SlideChrome } from "../components/SlideChrome";
import { FONT_FAMILY } from "../fonts";
import { SCRIPT } from "../data/script";

const JOBS = [
  { label: "Social Media Manager", x: 0.2, y: 0.3 },
  { label: "Cloud Architect", x: 0.74, y: 0.26 },
  { label: "App Developer", x: 0.3, y: 0.62 },
  { label: "Data Scientist", x: 0.7, y: 0.66 },
  { label: "UX Designer", x: 0.5, y: 0.22 },
];

/**
 * Slide 05 — THE PRECEDENT.
 * Job titles that didn't exist before the internet pop onto the network one
 * by one, each on a glowing pill, proving the "new categories of work" point.
 */
export const Slide05Internet: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const copy = SCRIPT.slide05Internet;

  const build = spring({
    frame,
    fps,
    config: { damping: 22, mass: 1, stiffness: 55 },
  });

  const headlineIn = interpolate(frame, [sec(3.4), sec(4)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Background bloom={COLORS.line} />
      <NodeField
        count={40}
        color={COLORS.accent}
        lineColor={COLORS.line}
        opacity={0.4}
        build={build}
        seedOffset={5}
      />

      {/* Job pills */}
      <AbsoluteFill>
        {JOBS.map((job, i) => {
          const delay = sec(0.8) + i * sec(0.4);
          const p = spring({
            frame: frame - delay,
            fps,
            config: { damping: 12, mass: 0.7, stiffness: 130 },
          });
          const scale = interpolate(p, [0, 1], [0.6, 1]);
          return (
            <div
              key={job.label}
              style={{
                position: "absolute",
                left: `${job.x * 100}%`,
                top: `${job.y * 100}%`,
                transform: `translate(-50%, -50%) scale(${scale})`,
                opacity: p,
                padding: "16px 30px",
                borderRadius: 999,
                background: hexA(COLORS.panel, 0.85),
                border: `1.5px solid ${hexA(COLORS.accent, 0.8)}`,
                boxShadow: `0 0 26px ${hexA(COLORS.accent, 0.45)}`,
                fontFamily: FONT_FAMILY,
                fontWeight: FONT.weightBold,
                fontSize: 30,
                color: COLORS.foreground,
                whiteSpace: "nowrap",
              }}
            >
              {job.label}
            </div>
          );
        })}
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 130,
        }}
      >
        <div
          style={{
            textAlign: "center",
            opacity: headlineIn,
            transform: `translateY(${(1 - headlineIn) * 20}px)`,
          }}
        >
          <div style={{ marginBottom: 20 }}>
            <Kicker color={COLORS.line}>{copy.kicker ?? ""}</Kicker>
          </div>
          <GlowText fontSize={72} glowStrength={0.7}>
            {copy.headline}
          </GlowText>
        </div>
      </AbsoluteFill>

      <SlideChrome act={copy.act} slideId={copy.id} accentColor={COLORS.line} />
    </AbsoluteFill>
  );
};
