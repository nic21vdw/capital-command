import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Stage } from "../components/Stage";
import { FloatingScreen } from "../components/FloatingScreen";
import { clipFade, drift, enter, ramp, SPRING_HERO, SPRING_POP, stagger } from "../motion";
import { CLIP_FRAMES, theme, fontFamily } from "../theme";
import { Glyph, hexA, Kicker, Text } from "../components/ui";

/**
 * "Calendar Fill" — a month of content scheduling itself.
 *
 * The Master Calendar fills day by day, and then an iOS confirmation sheet
 * rises over it with the channels it went out to. The sheet uses the real iOS
 * presentation language: the screen behind scales down and dims slightly, the
 * sheet rides a spring with a grabber handle on top, and the channel rows land
 * one after another.
 */
const CHANNELS = [
  { name: "YouTube", detail: "4 long-form · 18 shorts", color: "#ff4d4f" },
  { name: "Instagram", detail: "18 reels · 6 carousels", color: theme.pink },
  { name: "TikTok", detail: "18 clips", color: theme.cyan },
  { name: "X / Threads", detail: "26 posts", color: theme.text },
];

export const CalendarFill: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = clipFade(frame, CLIP_FRAMES);

  const present = enter(frame, fps, 0, SPRING_HERO);
  // Sheet takes over the second half of the clip.
  const sheet = enter(frame, fps, 72, { damping: 24, stiffness: 120, mass: 0.9 });
  const behind = 1 - sheet * 0.08; // the "screen steps back" cue

  return (
    <Stage tint="#2fd08a" shiftX={drift(frame, 150, 0.8) * 18} shiftY={drift(frame, 150, 2.6) * 12}>
      <AbsoluteFill style={{ perspective: 1900, opacity: fade }}>
        <AbsoluteFill style={{ transformStyle: "preserve-3d", transform: `scale(${behind})` }}>
          <FloatingScreen
            variant="calendar"
            scale={0.68 * (0.93 + 0.07 * present)}
            x={0}
            y={-40 + (1 - present) * 200 + drift(frame, 150) * 8}
            rotateX={4}
            rotateY={-3}
            opacity={present * (1 - sheet * 0.35)}
            blur={sheet * 3}
            progress={ramp(frame, 12, 96)}
            sheen={ramp(frame, 30, 92)}
          />
        </AbsoluteFill>

        {/* dim layer under the sheet */}
        <AbsoluteFill style={{ background: "#000", opacity: sheet * 0.32, pointerEvents: "none" }} />

        <ConfirmSheet progress={sheet} frame={frame} fps={fps} />
      </AbsoluteFill>
    </Stage>
  );
};

const ConfirmSheet: React.FC<{ progress: number; frame: number; fps: number }> = ({ progress, frame, fps }) => (
  <div
    style={{
      position: "absolute",
      left: "50%",
      bottom: 0,
      width: 900,
      marginLeft: -450,
      transform: `translateY(${(1 - progress) * 620}px)`,
      opacity: Math.min(1, progress * 2),
      borderRadius: "28px 28px 0 0",
      padding: "14px 36px 52px",
      fontFamily,
      background: `linear-gradient(180deg, ${hexA("#ffffff", 0.11)}, ${hexA("#ffffff", 0.04)})`,
      border: `1px solid ${hexA("#ffffff", 0.16)}`,
      borderBottom: "none",
      boxShadow: "0 -30px 90px -20px rgba(0,0,0,0.9)",
      backdropFilter: "blur(40px)",
    }}
  >
    {/* grabber */}
    <div style={{ width: 46, height: 5, borderRadius: 3, background: hexA("#ffffff", 0.35), margin: "0 auto 22px" }} />

    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
      <div
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          background: hexA(theme.mint, 0.18),
          border: `1px solid ${hexA(theme.mint, 0.5)}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Glyph kind="check" size={22} color={theme.mint} />
      </div>
      <div>
        <Kicker color={theme.mint} size={13}>
          Scheduled
        </Kicker>
        <Text size={30} weight={650} style={{ marginTop: 4 }}>
          72 posts queued across 4 channels
        </Text>
      </div>
    </div>

    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {CHANNELS.map((c, i) => {
        const row = stagger(frame, fps, i, 86, 5, SPRING_POP);
        return (
          <div
            key={c.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "14px 18px",
              borderRadius: 16,
              background: hexA("#ffffff", 0.05),
              border: `1px solid ${hexA("#ffffff", 0.1)}`,
              opacity: row,
              transform: `translateY(${(1 - row) * 18}px)`,
            }}
          >
            <div style={{ width: 10, height: 10, borderRadius: 5, background: c.color, boxShadow: `0 0 14px 3px ${hexA(c.color, 0.6)}` }} />
            <Text size={19} weight={600}>
              {c.name}
            </Text>
            <div style={{ marginLeft: "auto" }}>
              <Text size={16} color={theme.muted}>
                {c.detail}
              </Text>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);
