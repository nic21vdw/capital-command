import React from "react";
import { theme, fontFamily } from "../theme";

export const WORD = "CoLateral";

/** Brand capitalisation: the two capitals (C, L) carry the purple brand
 *  colour; the lowercase letters are near-black ink. */
const letterColor = (ch: string) =>
  ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? theme.brand : theme.ink;

/**
 * The "CoLateral" wordmark. Reveal animation is delegated to the caller via
 * `styleFor(i, ch)` — return a per-letter CSS transform/opacity. With no
 * `styleFor` the whole wordmark just renders statically (useful under a
 * parent clip/wipe reveal).
 */
export const Wordmark: React.FC<{
  fontSize: number;
  styleFor?: (i: number, ch: string) => React.CSSProperties;
}> = ({ fontSize, styleFor }) => (
  <div
    style={{
      display: "flex",
      fontFamily,
      fontWeight: 800,
      fontSize,
      letterSpacing: -2,
      lineHeight: 1,
      whiteSpace: "pre",
    }}
  >
    {WORD.split("").map((ch, i) => (
      <span
        key={i}
        style={{
          display: "inline-block",
          color: letterColor(ch),
          ...(styleFor ? styleFor(i, ch) : null),
        }}
      >
        {ch}
      </span>
    ))}
  </div>
);
