import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { BeamBuddy } from "../components/BeamBuddy";
import { Wordmark } from "../components/Wordmark";
import { SpeechBubble } from "../components/SpeechBubble";
import { theme } from "../theme";

/**
 * Iteration D — "Beam Greeting" (5s, white).
 *
 * The beam-sweep reveal you liked, with a personality beat. Beam Buddy pops in
 * with pulse rings and steps left, fires a bright beam that wipes the
 * "CoLateral" wordmark in left-to-right, then pipes up with a speech bubble —
 * "I'm reinforced by all your good vibes." Playful and on-brand.
 */
export const IntroBeamGreeting: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Pop-in with overshoot.
  const pop = spring({ frame, fps, config: { damping: 11, mass: 0.8 } });
  const popScale = interpolate(pop, [0, 1], [0.3, 1]);

  // Buddy steps from centre to its left slot as the name appears to its right.
  const step = spring({ frame: frame - 26, fps, config: { damping: 16 } });
  const HALF_SHIFT = 400;
  const buddyX = interpolate(step, [0, 1], [HALF_SHIFT, 0]);

  // Wipe reveal of the wordmark, following the beam sweep.
  const WORDMARK_W = 720;
  const sweep = spring({ frame: frame - 30, fps, config: { damping: 20, mass: 0.7 } });
  const p = interpolate(sweep, [0, 1], [0, 1]);
  const clipRight = (1 - p) * 100;
  const barX = p * WORDMARK_W;

  // Speech bubble pops in above Buddy after the name lands.
  const say = spring({ frame: frame - 92, fps, config: { damping: 12, mass: 0.7 } });

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "row",
          gap: 64,
        }}
      >
        {/* Beam Buddy — pops in centre, steps left, then speaks */}
        <div style={{ transform: `translateX(${buddyX}px) scale(${popScale})` }}>
          <div style={{ position: "relative" }}>
            <PulseRings frame={frame} fps={fps} />
            {/* speech bubble, anchored up and to Buddy's right */}
            <div
              style={{
                position: "absolute",
                left: 210,
                top: -70,
                transformOrigin: "bottom left",
                transform: `scale(${say})`,
                opacity: say,
              }}
            >
              <SpeechBubble width={250} fontSize={28}>
                I&apos;m reinforced by all your good vibes.
              </SpeechBubble>
            </div>
            <BeamBuddy size={300} phase={13} />
          </div>
        </div>

        {/* Wordmark, revealed by a left-to-right wipe */}
        <div style={{ position: "relative", width: WORDMARK_W, height: 170 }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              clipPath: `inset(-40% ${clipRight}% -40% -10%)`,
            }}
          >
            <Wordmark fontSize={132} />
          </div>

          {/* the light bar riding the reveal edge */}
          <div
            style={{
              position: "absolute",
              top: -18,
              bottom: -18,
              left: barX,
              width: 10,
              borderRadius: 6,
              opacity: p > 0.001 && p < 0.999 ? 1 : 0,
              background: `linear-gradient(${theme.brandLight}, ${theme.brandDark})`,
              boxShadow: `0 0 34px 10px ${theme.brandLight}, 0 0 90px 24px rgba(77,151,255,0.45)`,
            }}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Two expanding rings behind Buddy on the pop-in, à la a logo reveal. */
const PulseRings: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => (
  <>
    {[0, 12].map((delay) => {
      const ring = spring({
        frame: frame - 4 - delay,
        fps,
        config: { damping: 30 },
        durationInFrames: 46,
      });
      return (
        <div
          key={delay}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 300,
            height: 300,
            marginLeft: -150,
            marginTop: -150,
            borderRadius: "50%",
            border: `4px solid ${theme.brandLight}`,
            transform: `scale(${interpolate(ring, [0, 1], [0.5, 2.2])})`,
            opacity: interpolate(ring, [0, 0.2, 1], [0, 0.45, 0]),
          }}
        />
      );
    })}
  </>
);
