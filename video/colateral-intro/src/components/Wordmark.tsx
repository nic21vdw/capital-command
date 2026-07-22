import React from "react";
import { theme, fontFamily } from "../theme";

export const WORD = "CoLateral";

/** Brand capitalisation: "Co" reads near-black navy ink, "Lateral" carries the
 *  vivid brand blue — matching the CoLateral wordmark. Split is positional
 *  (first two letters ink), so the lowercase "o" stays dark and only the
 *  second word turns blue. */
const BLUE_FROM = 2; // index at which the wordmark switches to brand blue
const letterColor = (i: number) => (i < BLUE_FROM ? theme.ink : theme.brand);

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
          color: letterColor(i),
          ...(styleFor ? styleFor(i, ch) : null),
        }}
      >
        {ch}
      </span>
    ))}
  </div>
);
