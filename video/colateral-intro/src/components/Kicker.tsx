import React from "react";
import { theme, fontFamily } from "../theme";

/**
 * A small-caps brand kicker label, e.g. "THE ALL-IN-ONE ENGINEERING WORKSPACE"
 * — the tracked, uppercase blue eyebrow that sits above the CoLateral wordmark
 * in the brand artwork. Optional flanking rules give it the engineering-doc
 * feel. Reveal is the caller's job.
 */
export const Kicker: React.FC<{
  children: React.ReactNode;
  fontSize?: number;
  rules?: boolean;
}> = ({ children, fontSize = 26, rules = false }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 18,
      color: theme.brand,
      fontFamily,
      fontWeight: 800,
      fontSize,
      letterSpacing: fontSize * 0.28,
      textTransform: "uppercase",
      whiteSpace: "nowrap",
    }}
  >
    {rules && <span style={{ width: 46, height: 2, background: theme.grid }} />}
    <span style={{ textIndent: fontSize * 0.28 }}>{children}</span>
    {rules && <span style={{ width: 46, height: 2, background: theme.grid }} />}
  </div>
);
