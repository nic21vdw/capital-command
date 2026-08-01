import React from "react";
import { AbsoluteFill } from "remotion";
import { theme } from "../theme";

/**
 * The CoLateral stage: the app's near-black blue-grey page with two soft purple
 * radial blooms and the faint dot grid from `.grid` on the front page. Every
 * reveal sits on this so the B-roll and the product share one background.
 */
export const Backdrop: React.FC<{
  /** Dot-grid opacity (0 hides it). */
  grid?: number;
  /** Bloom intensity multiplier. */
  glow?: number;
  /** Dot pitch in px. */
  pitch?: number;
}> = ({ grid = 1, glow = 1, pitch = 34 }) => (
  <>
    <AbsoluteFill style={{ backgroundColor: theme.bg }} />

    {/* purple blooms, echoing the hero's radial gradients */}
    <AbsoluteFill
      style={{
        background: `
          radial-gradient(circle at 18% -8%, rgba(189,147,249,${0.2 * glow}), transparent 42%),
          radial-gradient(circle at 84% 6%, rgba(181,128,255,${0.14 * glow}), transparent 44%),
          radial-gradient(circle at 50% 118%, rgba(138,92,201,${0.12 * glow}), transparent 48%)
        `,
      }}
    />

    {/* dot grid, faded out toward the edges so it never fights the wordmark */}
    {grid > 0 && (
      <AbsoluteFill
        style={{
          opacity: grid,
          backgroundImage: `radial-gradient(${theme.grid} 1px, transparent 1.5px)`,
          backgroundSize: `${pitch}px ${pitch}px`,
          maskImage:
            "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,0,0,.85), transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,0,0,.85), transparent 78%)",
        }}
      />
    )}

    {/* gentle vignette to seat the frame */}
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(ellipse 80% 70% at 50% 50%, transparent 55%, rgba(0,0,0,.5) 100%)",
      }}
    />
  </>
);
