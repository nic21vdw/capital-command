import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOR_BG, COLOR_MUTED, COLOR_PRIMARY, COLOR_REVEAL, COLOR_TEXT, FONT_FAMILY, WEIGHT, withAlpha } from "../theme";

// VO timing (scene runs 0:12–0:20 of the B-roll block):
//   "Three companies, three completely different bets…
//    and the sleeper is the one with the cheapest tokens."
// Marks fade in staggered on the first line; the green arrow next to the
// X/Grok mark is the reveal — land it on "sleeper".

const MARK_STAGGER = 14; // frames between each mark's entrance
const ARROW_FRAME = 70; // when the green Grok reveal arrow fires

// Abstract geometric placeholder marks (NOT real brand logos — swap the SVG
// internals for licensed art before publishing if you want the real logos).

/** Two crossing strokes — stands in for the X/Grok mark. */
const XMark: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <line x1={22} y1={22} x2={78} y2={78} stroke={color} strokeWidth={12} strokeLinecap="round" />
    <line x1={78} y1={22} x2={22} y2={78} stroke={color} strokeWidth={12} strokeLinecap="round" />
  </svg>
);

/** Three interlocked arcs — stands in for the OpenAI-style knot mark. */
const KnotMark: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    {[0, 120, 240].map((deg) => (
      <circle
        key={deg}
        cx={50}
        cy={38}
        r={22}
        fill="none"
        stroke={color}
        strokeWidth={9}
        transform={`rotate(${deg} 50 50)`}
      />
    ))}
  </svg>
);

/** Radiating starburst — stands in for the Claude burst mark. */
const BurstMark: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    {Array.from({ length: 8 }, (_, i) => {
      const angle = (i * Math.PI) / 4;
      return (
        <line
          key={i}
          x1={50 + Math.cos(angle) * 14}
          y1={50 + Math.sin(angle) * 14}
          x2={50 + Math.cos(angle) * 34}
          y2={50 + Math.sin(angle) * 34}
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
        />
      );
    })}
  </svg>
);

const PLAYERS = [
  { label: "GROK", Mark: XMark, x: -520, y: 160 }, // bottom-left of the triangle
  { label: "OPENAI", Mark: KnotMark, x: 0, y: -240 }, // apex
  { label: "CLAUDE", Mark: BurstMark, x: 520, y: 160 } // bottom-right
] as const;

/**
 * Scene 3 · 8s (240f). Three abstract placeholder logo marks arranged in a
 * tension triangle, each rimmed in orange-red, fading in staggered — then a
 * green upward arrow (the ONLY green in the video) fires next to the X/Grok
 * mark as the "sleeper" reveal.
 */
export const PlayersScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const arrow = spring({ frame: frame - ARROW_FRAME, fps, config: { damping: 10, mass: 0.7 } });
  const arrowY = interpolate(arrow, [0, 1], [46, 0]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLOR_BG,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: FONT_FAMILY
      }}
    >
      {PLAYERS.map(({ label, Mark, x, y }, i) => {
        const s = spring({ frame: frame - 8 - i * MARK_STAGGER, fps, config: { damping: 13, mass: 0.8 } });
        const scale = interpolate(s, [0, 1], [0.6, 1]);
        return (
          <div
            key={label}
            style={{
              position: "absolute",
              transform: `translate(${x}px, ${y}px) scale(${scale})`,
              opacity: s,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 24
            }}
          >
            {/* Orange-red rim + soft glow around each mark. */}
            <div
              style={{
                width: 240,
                height: 240,
                borderRadius: "50%",
                border: `3px solid ${COLOR_PRIMARY}`,
                boxShadow: `0 0 56px ${withAlpha(COLOR_PRIMARY, 0.35)}, inset 0 0 32px ${withAlpha(COLOR_PRIMARY, 0.15)}`,
                display: "flex",
                justifyContent: "center",
                alignItems: "center"
              }}
            >
              <Mark size={130} color={COLOR_TEXT} />
            </div>
            <span style={{ fontSize: 30, fontWeight: WEIGHT.bold, color: COLOR_MUTED, letterSpacing: 8 }}>{label}</span>
          </div>
        );
      })}

      {/* Green upward arrow — the reveal, pinned beside the X/Grok mark. */}
      <div
        style={{
          position: "absolute",
          transform: `translate(${PLAYERS[0].x + 190}px, ${PLAYERS[0].y - 60 + arrowY}px)`,
          opacity: arrow
        }}
      >
        <svg width={90} height={110} viewBox="0 0 90 110">
          <path
            d="M45 8 L82 52 L60 52 L60 102 L30 102 L30 52 L8 52 Z"
            fill={COLOR_REVEAL}
            style={{ filter: `drop-shadow(0 0 16px ${withAlpha(COLOR_REVEAL, 0.7)})` }}
          />
        </svg>
      </div>
    </AbsoluteFill>
  );
};
