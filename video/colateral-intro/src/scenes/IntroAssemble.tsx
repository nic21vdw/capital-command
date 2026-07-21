import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { BeamBuddy } from "../components/BeamBuddy";
import { BlueprintGrid } from "../components/BlueprintGrid";
import { Wordmark } from "../components/Wordmark";
import { theme } from "../theme";

/**
 * Iteration A — "Assemble" (5s, white).
 *
 * Beam Buddy drops in from above and lands with a little squash on a faint
 * blueprint grid, a purple structural "beam" draws itself in left-to-right,
 * and the "CoLateral" wordmark settles onto the beam letter by letter. Buddy
 * gives a friendly wave to close. Calm, premium, structural.
 */
export const IntroAssemble: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Beam Buddy drops from above with a springy landing.
  const drop = spring({ frame: frame - 6, fps, config: { damping: 9, mass: 0.9 } });
  const buddyY = interpolate(drop, [0, 1], [-620, 0]);
  // brief squash-and-stretch as it touches down (~frame 34)
  const landPulse =
    frame >= 34 ? Math.max(0, Math.sin((frame - 34) * 0.5)) * Math.max(0, 1 - (frame - 34) / 12) : 0;
  const buddyScaleY = 1 - 0.16 * landPulse;
  const buddyScaleX = 1 + 0.12 * landPulse;

  // Structural beam draws in from the left.
  const beam = spring({ frame: frame - 34, fps, config: { damping: 17 } });

  // Wordmark letters rise onto the beam, staggered.
  const styleFor = (i: number) => {
    const s = spring({
      frame: frame - 46 - i * 3,
      fps,
      config: { damping: 13, mass: 0.6 },
    });
    return {
      opacity: s,
      transform: `translateY(${interpolate(s, [0, 1], [48, 0])}px)`,
    };
  };

  const WORDMARK_W = 760;

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <BlueprintGrid />

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "row",
          gap: 56,
        }}
      >
        {/* Beam Buddy */}
        <div
          style={{
            transform: `translateY(${buddyY}px) scale(${buddyScaleX}, ${buddyScaleY})`,
            transformOrigin: "bottom center",
          }}
        >
          <BeamBuddy size={300} waveFrom={104} />
        </div>

        {/* Wordmark stacked on its structural beam */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <Wordmark fontSize={150} styleFor={styleFor} />

          {/* the beam: a purple gradient bar with bolt caps, drawn in from left */}
          <div
            style={{
              position: "relative",
              width: WORDMARK_W,
              height: 16,
              marginTop: 26,
              borderRadius: 8,
              transformOrigin: "left center",
              transform: `scaleX(${beam})`,
              background: `linear-gradient(90deg, ${theme.brandDark}, ${theme.brandLight})`,
              boxShadow: `0 10px 24px -8px ${theme.brand}`,
            }}
          >
            <BoltCap side="left" />
            <BoltCap side="right" />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** A small bolt/rivet at the end of the structural beam. */
const BoltCap: React.FC<{ side: "left" | "right" }> = ({ side }) => (
  <div
    style={{
      position: "absolute",
      top: "50%",
      [side]: -6,
      transform: "translateY(-50%)",
      width: 26,
      height: 26,
      borderRadius: "50%",
      background: theme.bg,
      border: `5px solid ${theme.brandDark}`,
      boxSizing: "border-box",
    }}
  />
);
