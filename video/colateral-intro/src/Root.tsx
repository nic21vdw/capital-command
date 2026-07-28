import React from "react";
import { Composition } from "remotion";
import { RevealDraftingTable } from "./scenes/RevealDraftingTable";
import { RevealLoadPath } from "./scenes/RevealLoadPath";
import { RevealBeamyEntrance } from "./scenes/RevealBeamyEntrance";
import { RevealCanvasSpawn } from "./scenes/RevealCanvasSpawn";
import { RevealTypeset } from "./scenes/RevealTypeset";
import { VIDEO } from "./theme";

/**
 * CoLateral name-reveal intro cards, 1920×1080 @ 30fps.
 *
 * All five sit on the live product's dark stage (#070c12) with the brand purple
 * (#bd93f9), the real "Co" + "Lateral" wordmark split, and Beamy — the app's
 * pixel-art I-beam mascot — ported pixel-for-pixel from `Beamy.js`.
 *
 *   RevealDraftingTable  — mark draws on, letters spawn, Beamy waves (calm)
 *   RevealLoadPath       — loads, deflection + moment diagram (structural)
 *   RevealBeamyEntrance  — Beamy dances, letters spawn on the beat (playful)
 *   RevealCanvasSpawn    — real tool cards link up, converge into the mark
 *   RevealTypeset        — the live hero, animated (minimal / most corporate)
 */
export const RemotionRoot: React.FC = () => {
  const base = { fps: VIDEO.fps, width: VIDEO.width, height: VIDEO.height } as const;

  return (
    <>
      <Composition
        id="RevealDraftingTable"
        component={RevealDraftingTable}
        durationInFrames={180}
        {...base}
      />
      <Composition id="RevealLoadPath" component={RevealLoadPath} durationInFrames={180} {...base} />
      <Composition
        id="RevealBeamyEntrance"
        component={RevealBeamyEntrance}
        durationInFrames={180}
        {...base}
      />
      <Composition
        id="RevealCanvasSpawn"
        component={RevealCanvasSpawn}
        durationInFrames={195}
        {...base}
      />
      <Composition id="RevealTypeset" component={RevealTypeset} durationInFrames={180} {...base} />
    </>
  );
};
