import React from "react";
import { AppWindow, ScreenVariant, WINDOW } from "./AppWindow";
import { theme } from "../theme";
import { hexA } from "./ui";

/**
 * One product screenshot, floating in the scene.
 *
 * The window always renders at its native {@link WINDOW} size and is scaled
 * down here, so text stays sharp no matter how far "back" a screen sits. The
 * card carries the depth cues that make it read as a physical object: a long
 * soft shadow, a 1px specular edge, a glass sheen swept across the glass, and
 * an optional depth-of-field blur for anything off the focal plane.
 */
export const FloatingScreen: React.FC<{
  variant: ScreenVariant;
  /** Scale relative to the native 1280×820 window. */
  scale?: number;
  x?: number;
  y?: number;
  /** Degrees. Small values only — a screenshot should stay legible. */
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  /** Pushes the card toward/away from the camera in the parent's 3D space. */
  z?: number;
  opacity?: number;
  /** Depth-of-field blur in px. Keep under ~8 or the render slows noticeably. */
  blur?: number;
  /** 0 → 1 progress for the in-screen animation. */
  progress?: number;
  /** 0 → 1 position of the specular sheen sweeping the glass; <0 hides it. */
  sheen?: number;
  chrome?: boolean;
  style?: React.CSSProperties;
}> = ({
  variant,
  scale = 0.5,
  x = 0,
  y = 0,
  rotateX = 0,
  rotateY = 0,
  rotateZ = 0,
  z = 0,
  opacity = 1,
  blur = 0,
  progress = 1,
  sheen = -1,
  chrome = true,
  style,
}) => (
  <div
    style={{
      position: "absolute",
      left: "50%",
      top: "50%",
      width: WINDOW.width,
      height: WINDOW.height,
      marginLeft: -WINDOW.width / 2,
      marginTop: -WINDOW.height / 2,
      opacity,
      filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
      transform: [
        `translate3d(${x}px, ${y}px, ${z}px)`,
        `rotateX(${rotateX}deg)`,
        `rotateY(${rotateY}deg)`,
        `rotateZ(${rotateZ}deg)`,
        `scale(${scale})`,
      ].join(" "),
      transformStyle: "preserve-3d",
      ...style,
    }}
  >
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: 22,
        // Shadow scales with the card so a small, distant screen does not get a
        // giant shadow — divide by the scale it is about to be shrunk by.
        boxShadow: `0 ${60 / scale}px ${140 / scale}px ${-20 / scale}px rgba(0,0,0,0.85), 0 ${8 / scale}px ${
          24 / scale
        }px rgba(0,0,0,0.5)`,
      }}
    >
      <AppWindow variant={variant} progress={progress} chrome={chrome} />

      {/* specular edge — the 1px rim light along the top of real glass */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 22,
          pointerEvents: "none",
          background: `linear-gradient(180deg, ${hexA("#ffffff", 0.16)} 0%, transparent 14%, transparent 86%, ${hexA(
            "#000000",
            0.3
          )} 100%)`,
          mixBlendMode: "overlay",
        }}
      />

      {/* sheen sweep */}
      {sheen >= 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 22,
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "-40%",
              bottom: "-40%",
              left: `${sheen * 160 - 40}%`,
              width: "26%",
              transform: "rotate(14deg)",
              background: `linear-gradient(90deg, transparent, ${hexA("#ffffff", 0.14)}, transparent)`,
            }}
          />
        </div>
      )}
    </div>

    {/* contact glow: the light the screen throws onto the room */}
    <div
      style={{
        position: "absolute",
        inset: "18%",
        borderRadius: "50%",
        background: `radial-gradient(circle, ${hexA(theme.accent, 0.32)} 0%, transparent 70%)`,
        filter: "blur(60px)",
        zIndex: -1,
        pointerEvents: "none",
      }}
    />
  </div>
);
