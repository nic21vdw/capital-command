import React from "react";
import { AbsoluteFill } from "remotion";
import { TypewriterText } from "../components/TypewriterText";
import { theme, fontFamily } from "../theme";

/** Hook lines typed on one at a time over a clean near-black background. */
export const Tagline: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.bg,
        justifyContent: "center",
        alignItems: "center",
        padding: 80,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 28, alignItems: "center", textAlign: "center" }}>
        <TypewriterText text="Free AI tools." startFrame={0} fontSize={78} />
        <TypewriterText text="Built for real people." startFrame={30} fontSize={78} color={theme.text} />
        <div style={{ height: 8 }} />
        <span
          style={{
            fontFamily,
            fontWeight: 700,
            fontSize: 52,
            color: theme.highlight,
            opacity: 1,
          }}
        >
          <TypewriterText text="No fee. No catch." startFrame={72} fontSize={52} color={theme.highlight} />
        </span>
      </div>
    </AbsoluteFill>
  );
};
