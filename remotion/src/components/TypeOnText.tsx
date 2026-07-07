import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import { COLORS, FONT, glow } from "../config";
import { FONT_FAMILY } from "../fonts";

/**
 * TypeOnText — a monospaced-feel typewriter reveal with a blinking caret.
 * `startFrame`/`charsPerFrame` are timing-driven so callers control cadence.
 */
export const TypeOnText: React.FC<{
  text: string;
  startFrame?: number;
  framesPerChar?: number;
  color?: string;
  fontSize?: number;
  showCaret?: boolean;
  glowStrength?: number;
}> = ({
  text,
  startFrame = 0,
  framesPerChar = 3,
  color = COLORS.foreground,
  fontSize = 220,
  showCaret = true,
  glowStrength = 1,
}) => {
  const frame = useCurrentFrame();
  const elapsed = Math.max(0, frame - startFrame);
  const shown = Math.min(text.length, Math.floor(elapsed / framesPerChar));
  const visible = text.substring(0, shown);
  const done = shown >= text.length;

  // Blinking caret at ~2Hz.
  const caretOn = Math.floor(frame / 15) % 2 === 0;

  return (
    <div
      style={{
        fontFamily: FONT_FAMILY,
        fontWeight: FONT.weightBlack,
        fontSize,
        color,
        letterSpacing: FONT.letterSpacingTight,
        textShadow: glow(color, glowStrength),
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      <span>{visible}</span>
      {showCaret && (!done || caretOn) ? (
        <span
          style={{
            display: "inline-block",
            width: fontSize * 0.06,
            height: fontSize * 0.78,
            marginLeft: fontSize * 0.06,
            background: COLORS.accent,
            boxShadow: glow(COLORS.accent, 1),
            opacity: caretOn ? 1 : 0.15,
            transform: "translateY(4%)",
          }}
        />
      ) : null}
    </div>
  );
};

/**
 * GlitchSwap — used by the hook slide: shows `from`, then hard-cuts to `to`
 * with a brief pink chromatic-aberration flicker at `swapFrame`.
 */
export const GlitchSwap: React.FC<{
  from: string;
  to: string;
  swapFrame: number;
  fontSize?: number;
}> = ({ from, to, swapFrame, fontSize = 300 }) => {
  const frame = useCurrentFrame();
  const swapped = frame >= swapFrame;
  const label = swapped ? to : from;

  // Flicker window right after the swap.
  const since = frame - swapFrame;
  const flicker = swapped && since < 8;
  const shift = flicker
    ? interpolate(since, [0, 8], [14, 0], { extrapolateRight: "clamp" })
    : 0;

  const base: React.CSSProperties = {
    fontFamily: FONT_FAMILY,
    fontWeight: FONT.weightBlack,
    fontSize,
    letterSpacing: FONT.letterSpacingTight,
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  return (
    <div style={{ position: "relative", width: "100%", height: fontSize * 1.2 }}>
      {flicker && (
        <div
          style={{
            ...base,
            color: COLORS.accentAlt,
            transform: `translateX(${-shift}px)`,
            mixBlendMode: "screen",
            opacity: 0.8,
          }}
        >
          {label}
        </div>
      )}
      {flicker && (
        <div
          style={{
            ...base,
            color: COLORS.line,
            transform: `translateX(${shift}px)`,
            mixBlendMode: "screen",
            opacity: 0.8,
          }}
        >
          {label}
        </div>
      )}
      <div
        style={{
          ...base,
          color: COLORS.foreground,
          textShadow: glow(swapped ? COLORS.accent : COLORS.foreground, 1),
        }}
      >
        {label}
      </div>
    </div>
  );
};
