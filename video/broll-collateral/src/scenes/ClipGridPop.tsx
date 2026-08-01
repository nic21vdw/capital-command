import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Stage } from "../components/Stage";
import { FloatingScreen } from "../components/FloatingScreen";
import { clipFade, drift, enter, ramp, SPRING_HERO, SPRING_POP, stagger } from "../motion";
import { CLIP_FRAMES, theme, fontFamily } from "../theme";
import { Glyph, hexA, Text } from "../components/ui";

/**
 * "Clip Grid Pop" — the Clip Generator producing shorts.
 *
 * The Clip Generator screen sits back and slightly angled while finished 9:16
 * clips lift OUT of it toward the camera, staggered on popping springs, then
 * hang and breathe. It is the shot for "one long video becomes a month of
 * shorts", and the vertical cards are legible even at small ad sizes.
 */
const CLIPS = [
  { title: "This one prompt replaced my whole workflow", score: 96, tint: theme.violet, x: -560, y: -30, rot: -7 },
  { title: "Why your AI agent keeps forgetting", score: 91, tint: theme.accent, x: -190, y: 60, rot: -2.5 },
  { title: "Claude made my SaaS build 4x faster", score: 88, tint: theme.cyan, x: 190, y: 20, rot: 3 },
  { title: "Stop paying for tools that do this free", score: 84, tint: theme.pink, x: 560, y: 90, rot: 8 },
];

export const ClipGridPop: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = clipFade(frame, CLIP_FRAMES);

  const present = enter(frame, fps, 0, SPRING_HERO);

  return (
    <Stage tint="#a78bfa" shiftX={drift(frame, 150, 0.4) * 22} shiftY={drift(frame, 150, 2.1) * 16}>
      <AbsoluteFill style={{ perspective: 2000, opacity: fade }}>
        <AbsoluteFill style={{ transformStyle: "preserve-3d" }}>
          {/* the source screen, pushed back behind the clips */}
          <FloatingScreen
            variant="clips"
            scale={0.58 * (0.94 + 0.06 * present)}
            x={0}
            y={-190 + (1 - present) * 90}
            z={-360}
            rotateX={9}
            blur={2.2}
            opacity={present * 0.9}
            progress={ramp(frame, 10, 86)}
          />

          {CLIPS.map((clip, i) => {
            const pop = stagger(frame, fps, i, 26, 8, SPRING_POP);
            const bob = drift(frame, 150, i * 1.4) * 14;
            return (
              <div
                key={clip.title}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  marginLeft: -150,
                  marginTop: -267,
                  opacity: pop,
                  transform: [
                    `translate3d(${clip.x}px, ${clip.y + bob + (1 - pop) * 150}px, ${pop * 180}px)`,
                    `rotateZ(${clip.rot * pop}deg)`,
                    `rotateY(${-clip.x * 0.012}deg)`,
                    `scale(${0.6 + 0.4 * pop})`,
                  ].join(" "),
                }}
              >
                <ClipCard title={clip.title} score={clip.score} tint={clip.tint} progress={ramp(frame, 30 + i * 8, 140)} />
              </div>
            );
          })}
        </AbsoluteFill>
      </AbsoluteFill>
    </Stage>
  );
};

/** A finished 9:16 short, as it appears in the generator's grid. */
const ClipCard: React.FC<{ title: string; score: number; tint: string; progress: number }> = ({
  title,
  score,
  tint,
  progress,
}) => (
  <div
    style={{
      width: 300,
      height: 534,
      borderRadius: 26,
      overflow: "hidden",
      position: "relative",
      fontFamily,
      background: `linear-gradient(165deg, ${hexA(tint, 0.65)} 0%, ${theme.bgDeep} 62%, #000 100%)`,
      border: `1px solid ${hexA("#ffffff", 0.16)}`,
      boxShadow: `0 46px 90px -22px rgba(0,0,0,0.9), inset 0 1px 0 ${hexA("#ffffff", 0.2)}`,
    }}
  >
    {/* progress bar, as on a short */}
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: hexA("#ffffff", 0.2) }}>
      <div style={{ width: `${progress * 100}%`, height: "100%", background: "#fff" }} />
    </div>

    {/* stand-in footage: a soft key light */}
    <div
      style={{
        position: "absolute",
        top: "24%",
        left: "50%",
        marginLeft: -110,
        width: 220,
        height: 220,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${hexA("#ffffff", 0.2)}, transparent 68%)`,
      }}
    />

    <div style={{ position: "absolute", top: 18, right: 16 }}>
      <div
        style={{
          padding: "6px 12px",
          borderRadius: 999,
          fontSize: 15,
          fontWeight: 700,
          color: score > 90 ? "#04150d" : theme.text,
          background: score > 90 ? theme.mint : hexA("#000000", 0.45),
          border: `1px solid ${hexA("#ffffff", 0.25)}`,
        }}
      >
        {score}
      </div>
    </div>

    <div style={{ position: "absolute", left: 20, right: 20, bottom: 26 }}>
      <Text size={22} weight={700} style={{ lineHeight: 1.18 }}>
        {title}
      </Text>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <Glyph kind="play" size={13} color="rgba(255,255,255,0.8)" />
        <Text size={13} color="rgba(255,255,255,0.75)">
          0:38 · 9:16 · captions burned in
        </Text>
      </div>
    </div>
  </div>
);
