import React from "react";
import { useCurrentFrame } from "remotion";
import { theme, fontFamily } from "../theme";

/**
 * Reveals text a character at a time on a fixed cadence, with a blinking
 * caret. `startFrame` offsets when typing begins; `cps` is characters/second
 * (assumes 30fps timeline).
 */
export const TypewriterText: React.FC<{
  text: string;
  startFrame?: number;
  cps?: number;
  color?: string;
  fontSize?: number;
}> = ({ text, startFrame = 0, cps = 22, color = theme.text, fontSize = 64 }) => {
  const frame = useCurrentFrame();
  const elapsed = Math.max(0, frame - startFrame);
  const shown = Math.min(text.length, Math.floor((elapsed / 30) * cps));
  const done = shown >= text.length;
  const caretOn = Math.floor(frame / 8) % 2 === 0;

  return (
    <span
      style={{
        fontFamily,
        fontWeight: 800,
        fontSize,
        color,
        letterSpacing: -1,
      }}
    >
      {text.slice(0, shown)}
      <span
        style={{
          opacity: done ? 0 : caretOn ? 1 : 0,
          color: theme.accent,
        }}
      >
        |
      </span>
    </span>
  );
};
