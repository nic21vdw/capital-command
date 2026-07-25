import React from "react";
import { theme, fontFamily } from "../theme";

export const WORD = "CoLateral";

/** Brand capitalisation, matching `<h1 class="wordmark">Co<span class="lat">Lateral</span></h1>`
 *  on the front page: "Co" is near-white ink, "Lateral" carries the brand
 *  purple. The split is positional (first two letters ink). */
const PURPLE_FROM = 2;
export const letterColor = (i: number) =>
  i < PURPLE_FROM ? theme.wordmarkInk : theme.brand;

/**
 * The "CoLateral" wordmark, typeset like the live hero: Inter 850,
 * letter-spacing -.055em, line-height .94.
 *
 * The reveal is delegated to the caller via `styleFor(i, ch)` — return a
 * per-letter CSS transform/opacity. With no `styleFor` the wordmark renders
 * statically (useful under a parent clip/wipe reveal).
 */
export const Wordmark: React.FC<{
  fontSize: number;
  styleFor?: (i: number, ch: string) => React.CSSProperties;
  /** Soft purple bloom behind the mark, as on the hero. */
  glow?: boolean;
}> = ({ fontSize, styleFor, glow = true }) => (
  <div
    style={{
      display: "flex",
      fontFamily,
      fontWeight: 850,
      fontSize,
      letterSpacing: "-0.055em",
      lineHeight: 0.94,
      whiteSpace: "pre",
      filter: glow ? `drop-shadow(0 0 42px rgba(189,147,249,.28))` : undefined,
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
