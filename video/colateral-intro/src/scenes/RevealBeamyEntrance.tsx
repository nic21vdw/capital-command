import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Beamy } from "../components/Beamy";
import { Wordmark } from "../components/Wordmark";
import { Eyebrow } from "../components/Type";
import { theme, copy } from "../theme";

/**
 * Reveal 3 — "Beamy's Entrance" (6s). The personality cut.
 *
 * Beamy drops into centre frame, then dances a four-beat 8-bit loop —
 * step, step, hop, spin — while the wordmark's letters spawn one per half
 * beat, snapping in on the rhythm he's dancing to. He steps aside as the mark
 * fills out, lands the last beat with a spin and sparkles, then winks.
 *
 * Everything is locked to BEAT frames, so it stays in time if you re-cut it.
 */

const BEAT = 15; // frames per beat @30fps = 120 BPM
const DANCE_FROM = 22;
const DANCE_UNTIL = DANCE_FROM + BEAT * 8; // two full bars
const LETTER_FROM = DANCE_FROM + BEAT; // letters start on the second beat

export const RevealBeamyEntrance: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Beamy drops in from above with a springy landing
  const drop = spring({ frame: frame - 2, fps, config: { damping: 10, mass: 0.9 } });
  const dropY = interpolate(drop, [0, 1], [-680, 0]);

  // ...then slides left to make room for the wordmark
  const shift = spring({ frame: frame - (DANCE_FROM + BEAT), fps, config: { damping: 18 } });
  const beamyX = interpolate(shift, [0, 1], [0, -600]);
  const beamyScale = interpolate(shift, [0, 1], [1.25, 1]);

  // letters spawn one per HALF beat, on the rhythm
  const styleFor = (i: number) => {
    const s = spring({
      frame: frame - (LETTER_FROM + i * (BEAT / 2)),
      fps,
      config: { damping: 11, mass: 0.42 },
    });
    return {
      opacity: s,
      transform: `translateY(${interpolate(s, [0, 1], [-70, 0])}px) scale(${interpolate(
        s,
        [0, 1],
        [1.6, 1],
      )}) rotate(${interpolate(s, [0, 1], [-8, 0])}deg)`,
    };
  };

  // beat pulse rings behind Beamy while he dances
  const dancing = frame >= DANCE_FROM && frame < DANCE_UNTIL;
  const beatPhase = dancing ? ((frame - DANCE_FROM) % BEAT) / BEAT : 0;
  const ring = dancing ? 1 - beatPhase : 0;

  const eyebrow = spring({ frame: frame - (DANCE_UNTIL - 22), fps, config: { damping: 18 } });

  return (
    <AbsoluteFill>
      <Backdrop grid={0.6} glow={1.15} />

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        {/* pulse rings, one per beat */}
        {dancing && (
          <div
            style={{
              position: "absolute",
              left: `calc(50% + ${beamyX}px)`,
              top: "50%",
              width: 340,
              height: 340,
              marginLeft: -170,
              marginTop: -170,
              borderRadius: "50%",
              border: `3px solid ${theme.brand}`,
              opacity: ring * 0.32,
              transform: `scale(${interpolate(ring, [0, 1], [1.9, 0.7])})`,
            }}
          />
        )}

        {/* Beamy */}
        <div
          style={{
            position: "absolute",
            transform: `translate(${beamyX}px, ${dropY}px) scale(${beamyScale})`,
            zIndex: 2,
          }}
        >
          <Beamy
            size={300}
            mood={frame >= DANCE_UNTIL ? "wink" : "happy"}
            action={frame >= DANCE_UNTIL ? "celebrate" : "idle"}
            danceFrom={DANCE_FROM}
            danceUntil={DANCE_UNTIL}
            beat={BEAT}
            waveFrom={DANCE_UNTIL + 4}
          />
        </div>

        {/* wordmark, spawning on the beat to Beamy's right */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
            marginLeft: 130,
          }}
        >
          <Wordmark fontSize={172} styleFor={styleFor} />
          <Eyebrow
            fontSize={24}
            style={{
              opacity: eyebrow,
              transform: `translateY(${interpolate(eyebrow, [0, 1], [14, 0])}px)`,
            }}
          >
            {copy.eyebrow}
          </Eyebrow>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
