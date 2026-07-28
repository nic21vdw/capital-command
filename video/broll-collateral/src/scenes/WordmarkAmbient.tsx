import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Stage, Bloom } from "../components/Stage";
import { FloatingScreen } from "../components/FloatingScreen";
import { Wordmark } from "../components/Wordmark";
import { clipFade, drift, easeIOS, enter, ramp, SPRING_HERO } from "../motion";
import { CLIP_FRAMES, theme, fontFamily } from "../theme";
import { hexA } from "../components/ui";

/**
 * "Wordmark Ambient" — the end-card / bookend clip.
 *
 * Product screens drift far back and out of focus while the CoLateral wordmark
 * resolves out of a blur, iOS-style: the blur and the scale come off together
 * on one deceleration curve, then the mark breathes. Cut it at the head or the
 * tail of an ad, or hold it under a voiceover.
 */
export const WordmarkAmbient: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = clipFade(frame, CLIP_FRAMES);

  const resolve = enter(frame, fps, 6, SPRING_HERO);
  const blur = interpolate(resolve, [0, 1], [26, 0]);
  const scale = interpolate(resolve, [0, 1], [1.12, 1]);
  const breathe = 1 + drift(frame, 150, Math.PI / 2) * 0.006;

  const tagline = interpolate(frame, [58, 88], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeIOS,
  });

  return (
    <Stage tint="#4d97ff" shiftX={drift(frame, 150) * 30} shiftY={drift(frame, 150, 1.4) * 20}>
      <AbsoluteFill style={{ perspective: 2200, opacity: fade }}>
        {/* deep-background product screens, heavily defocused */}
        <AbsoluteFill style={{ transformStyle: "preserve-3d" }}>
          <FloatingScreen variant="clips" scale={0.62} x={-620} y={-280 + drift(frame, 150, 0.7) * 24} z={-620} rotateY={24} blur={9} opacity={0.34} progress={ramp(frame, 0, 120)} />
          <FloatingScreen variant="calendar" scale={0.66} x={660} y={-180 + drift(frame, 150, 2.9) * 22} z={-560} rotateY={-22} blur={8} opacity={0.32} progress={ramp(frame, 4, 124)} />
          <FloatingScreen variant="editor" scale={0.58} x={-120} y={400 + drift(frame, 150, 4.1) * 26} z={-700} rotateY={6} rotateX={-10} blur={10} opacity={0.28} progress={ramp(frame, 8, 128)} />
        </AbsoluteFill>

        <Bloom color={theme.brandLight} size={1400} opacity={0.28 * resolve} style={{ left: "50%", top: "48%" }} />

        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 34 }}>
          <div
            style={{
              filter: blur > 0.4 ? `blur(${blur}px)` : undefined,
              transform: `scale(${scale * breathe})`,
              opacity: resolve,
            }}
          >
            <Wordmark fontSize={170} />
          </div>

          <div
            style={{
              fontFamily,
              fontSize: 30,
              fontWeight: 500,
              letterSpacing: 5,
              textTransform: "uppercase",
              color: theme.muted,
              opacity: tagline,
              transform: `translateY(${(1 - tagline) * 16}px)`,
            }}
          >
            One stream in. Every format out.
          </div>

          {/* hairline that draws under the tagline */}
          <div
            style={{
              width: 620 * tagline,
              height: 1,
              background: `linear-gradient(90deg, transparent, ${hexA(theme.accentStrong, 0.7)}, transparent)`,
            }}
          />
        </AbsoluteFill>
      </AbsoluteFill>
    </Stage>
  );
};
