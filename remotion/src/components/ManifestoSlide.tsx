import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { COLORS, AccentKey } from "../config";
import { Background } from "./Background";
import { NodeField } from "./NodeField";
import { GlowText, Kicker } from "./GlowText";
import { SlideChrome } from "./SlideChrome";
import type { SlideCopy } from "../data/script";

/**
 * ManifestoSlide — the reusable text-forward slide used for beats 3-14.
 * Takes a SlideCopy entry and an accent, renders:
 *   ambient node field → kicker → headline (word-staggered rise) → chrome.
 *
 * All motion is spring/interpolate based and driven purely by the current
 * frame, so it composes cleanly inside Sequences.
 */
export const ManifestoSlide: React.FC<{
  copy: SlideCopy;
  /** Override the accent token; defaults to the copy's own accent. */
  accentKey?: AccentKey;
  /** Density of the ambient background node field. */
  ambientNodes?: number;
}> = ({ copy, accentKey, ambientNodes = 26 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const key = (accentKey ?? copy.accent) as keyof typeof COLORS;
  const accentColor = COLORS[key] ?? COLORS.accent;

  // Headline rises in, word by word, respecting explicit line breaks.
  const lines = copy.headline.split("\n");
  let wordCounter = 0;

  const kickerIn = interpolate(frame, [4, 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Background bloom={accentColor} />
      <NodeField
        count={ambientNodes}
        color={accentColor}
        lineColor={COLORS.line}
        opacity={0.18}
        linkDistance={230}
        seedOffset={Number(copy.id)}
      />

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "0 160px",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 1500 }}>
          {copy.kicker ? (
            <div
              style={{
                opacity: kickerIn,
                transform: `translateY(${(1 - kickerIn) * 16}px)`,
                marginBottom: 34,
              }}
            >
              <Kicker color={accentColor}>{copy.kicker}</Kicker>
            </div>
          ) : null}

          {lines.map((line, li) => (
            <div
              key={li}
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: "0.1em 0.34em",
                marginTop: li === 0 ? 0 : "0.12em",
              }}
            >
              {line.split(" ").map((word, wi) => {
                const idx = wordCounter++;
                const delay = 10 + idx * 3.5;
                const p = spring({
                  frame: frame - delay,
                  fps,
                  config: { damping: 14, mass: 0.7, stiffness: 120 },
                });
                const y = interpolate(p, [0, 1], [46, 0]);
                return (
                  <span
                    key={wi}
                    style={{
                      display: "inline-block",
                      opacity: p,
                      transform: `translateY(${y}px)`,
                      whiteSpace: "pre",
                    }}
                  >
                    <HeadlineWord word={word} accentColor={accentColor} />
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </AbsoluteFill>

      <SlideChrome act={copy.act} slideId={copy.id} accentColor={accentColor} />
    </AbsoluteFill>
  );
};

/**
 * A single headline word. Words that end a line (contain "\n") get rendered
 * with a line break preserved. Emphasis words (wrapped in *asterisks* in copy)
 * render in the accent color with stronger glow.
 */
const HeadlineWord: React.FC<{ word: string; accentColor: string }> = ({
  word,
  accentColor,
}) => {
  const emphasised = word.startsWith("*") && word.endsWith("*");
  const clean = emphasised ? word.slice(1, -1) : word;
  return (
    <GlowText
      color={emphasised ? accentColor : COLORS.foreground}
      fontSize={94}
      glowStrength={emphasised ? 1.3 : 0.7}
      style={{ display: "inline" }}
    >
      {clean}
    </GlowText>
  );
};
