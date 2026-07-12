import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { ClaudeSpark } from "../components/ClaudeSpark";
import { theme, serifFamily, sansFamily } from "../theme";

const CAPABILITIES = [
  {
    title: "1M-token context",
    body: "Holds entire codebases and document sets in a single session",
  },
  {
    title: "Frontier reasoning",
    body: "Adaptive thinking that goes deeper on multi-step problems",
  },
  {
    title: "Agentic by design",
    body: "Claude Code runs tools, terminals, and whole agent teams",
  },
] as const;

/**
 * Proof points (≈5.3s): three capability cards stagger up in sequence, each
 * headed by its own spinning spark. Facts verified against Anthropic's 2026
 * model lineup (1M context, adaptive thinking, Claude Code agent teams).
 */
export const Capabilities: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const heading = spring({ frame: frame - 4, fps, config: { damping: 15 } });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <Backdrop glow={0.7} />

      <div
        style={{
          fontFamily: sansFamily,
          fontSize: 32,
          fontWeight: 600,
          letterSpacing: 9,
          color: theme.muted,
          marginBottom: 64,
          opacity: heading,
          transform: `translateY(${interpolate(heading, [0, 1], [24, 0])}px)`,
        }}
      >
        ONE MODEL. SERIOUS RANGE.
      </div>

      <div style={{ display: "flex", gap: 44 }}>
        {CAPABILITIES.map((cap, i) => {
          const s = spring({ frame: frame - 18 - i * 13, fps, config: { damping: 14, mass: 0.8 } });
          // cards keep a gentle float after landing so nothing sits static
          const float = Math.sin((frame - i * 20) / 24) * 6;
          return (
            <div
              key={cap.title}
              style={{
                width: 470,
                padding: "48px 44px 44px",
                borderRadius: 24,
                backgroundColor: theme.panel,
                border: `1px solid ${theme.accent}33`,
                boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
                opacity: s,
                transform: `translateY(${interpolate(s, [0, 1], [110, 0]) + float}px)`,
              }}
            >
              <ClaudeSpark size={64} rotation={frame * (i % 2 === 0 ? 1.4 : -1.4)} />
              <div
                style={{
                  marginTop: 34,
                  fontFamily: serifFamily,
                  fontSize: 50,
                  fontWeight: 600,
                  color: theme.ivory,
                  lineHeight: 1.1,
                }}
              >
                {cap.title}
              </div>
              <div
                style={{
                  marginTop: 18,
                  fontFamily: sansFamily,
                  fontSize: 27,
                  fontWeight: 500,
                  color: theme.cloud,
                  lineHeight: 1.45,
                }}
              >
                {cap.body}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
