import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { BeamBuddy } from "../components/BeamBuddy";
import { Wordmark, WORD } from "../components/Wordmark";
import { theme, pixelFontFamily } from "../theme";

/**
 * Iteration E — "Pixel Type" (5s, white).
 *
 * A retro, on-brand type-on. Beam Buddy hops in and the "CoLateral" wordmark
 * types itself out character-by-character behind a blinking blue block caret,
 * over faint CRT scanlines, with an 8-bit kicker underneath. Nods to the
 * pixel-art mascot — playful, techy, "the workspace boots up".
 */
export const IntroPixelType: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Beam Buddy pops in on the left.
  const pop = spring({ frame: frame - 4, fps, config: { damping: 12, mass: 0.8 } });
  const buddyScale = interpolate(pop, [0, 1], [0.4, 1]);
  const nod = Math.sin((frame / fps) * Math.PI * 1.4) * 2; // gentle head nod

  // Type-on: reveal one glyph every 6 frames, starting at frame 20.
  const START = 20;
  const PER = 6;
  const revealed = Math.max(0, Math.min(WORD.length, Math.floor((frame - START) / PER)));
  const typing = revealed < WORD.length;

  // Letters snap in instantly (typewriter); hidden ones collapse out of layout.
  const styleFor = (i: number): React.CSSProperties =>
    i < revealed ? { opacity: 1 } : { display: "none" };

  // Blinking block caret — solid while typing, then blinks ~every 0.4s.
  const caretOn = typing || Math.floor(frame / 12) % 2 === 0;

  // Kicker types/fades in once the name has finished.
  const kick = spring({ frame: frame - (START + WORD.length * PER + 6), fps, config: { damping: 200 } });

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "row",
          gap: 60,
        }}
      >
        {/* Beam Buddy, nodding along */}
        <div style={{ transform: `scale(${buddyScale}) rotate(${nod}deg)` }}>
          <BeamBuddy size={300} phase={5} waveFrom={128} />
        </div>

        {/* Typed wordmark + caret, kicker below */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 26 }}>
          <div style={{ display: "flex", alignItems: "center", height: 150 }}>
            <Wordmark fontSize={132} styleFor={styleFor} />
            {/* blinking block caret */}
            <span
              style={{
                display: "inline-block",
                width: 20,
                height: 116,
                marginLeft: 10,
                background: theme.brand,
                opacity: caretOn ? 1 : 0,
                boxShadow: `0 0 24px 4px rgba(31,111,230,0.5)`,
              }}
            />
          </div>

          <div
            style={{
              opacity: kick,
              color: theme.brand,
              fontFamily: pixelFontFamily,
              fontWeight: 700,
              fontSize: 20,
              letterSpacing: 4,
              textTransform: "uppercase",
            }}
          >
            The all-in-one engineering workspace
          </div>
        </div>
      </AbsoluteFill>

      {/* faint CRT scanlines over the whole frame */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          opacity: 0.05,
          backgroundImage: `repeating-linear-gradient(0deg, ${theme.deep} 0px, ${theme.deep} 2px, transparent 2px, transparent 5px)`,
        }}
      />
    </AbsoluteFill>
  );
};
