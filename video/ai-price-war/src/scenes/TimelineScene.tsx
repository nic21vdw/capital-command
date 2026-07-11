import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOR_BG, COLOR_MUTED, COLOR_PRIMARY, COLOR_TEXT, FONT_FAMILY, WEIGHT, withAlpha } from "../theme";

// VO timing (scene runs 0:00–0:05 of the B-roll block):
//   "In 48 hours: two new frontier models and a panic reset."
// Card 1 lands on "48 hours", cards 2–3 land on the model names. Reposition
// the <Sequence> in Video.tsx to line up with the cold-open footage.

const EVENTS = [
  { title: "GROK 4.5", date: "JUL 8" },
  { title: "GPT-5.6", date: "JUL 9" },
  { title: "CLAUDE LIMIT RESET", date: "JUL 9" }
] as const;

const CARD_STAGGER = 12; // frames between each card's entrance

/**
 * Scene 1 · 5s (150f). Three dated news cards slide in staggered from the
 * right on springs while a thin connector line draws left-to-right beneath
 * them — the "48-hour timeline" beat of the cold open.
 */
export const TimelineScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  // Connector line starts drawing once the first card has landed.
  const lineProgress = interpolate(frame, [24, 80], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLOR_BG,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: FONT_FAMILY
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 56 }}>
        <div style={{ display: "flex", gap: 48 }}>
          {EVENTS.map((event, i) => {
            const s = spring({ frame: frame - 6 - i * CARD_STAGGER, fps, config: { damping: 14, mass: 0.8 } });
            const x = interpolate(s, [0, 1], [width * 0.35, 0]);
            return (
              <div
                key={event.title}
                style={{
                  opacity: s,
                  transform: `translateX(${x}px)`,
                  width: 420,
                  padding: "44px 36px",
                  backgroundColor: withAlpha(COLOR_BG, 0.9),
                  border: `2px solid ${COLOR_PRIMARY}`,
                  borderRadius: 20,
                  boxShadow: `0 0 48px ${withAlpha(COLOR_PRIMARY, 0.28)}`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 16
                }}
              >
                <span style={{ fontSize: 24, fontWeight: WEIGHT.semibold, color: COLOR_MUTED, letterSpacing: 6 }}>
                  {event.date}
                </span>
                <span
                  style={{
                    fontSize: 44,
                    fontWeight: WEIGHT.extrabold,
                    color: COLOR_TEXT,
                    lineHeight: 1.15,
                    textAlign: "center"
                  }}
                >
                  {event.title}
                </span>
              </div>
            );
          })}
        </div>

        {/* Connector line drawing beneath the cards, left to right. */}
        <div style={{ width: 3 * 420 + 2 * 48, height: 4 }}>
          <div
            style={{
              width: `${lineProgress * 100}%`,
              height: "100%",
              borderRadius: 2,
              backgroundColor: COLOR_PRIMARY,
              boxShadow: `0 0 18px ${withAlpha(COLOR_PRIMARY, 0.7)}`
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
