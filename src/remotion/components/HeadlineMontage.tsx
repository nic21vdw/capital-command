import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, SAFE_MARGIN, shadow, type, withAlpha } from "../theme";

const HEADLINES = [
  { source: "Metro Wire", text: "Manhattan tower BEAM gives way, block evacuated" },
  { source: "The Daily Ledger", text: "Investigators eye failed BEAM in high-rise scare" },
  { source: "City Desk", text: "Residents rattled as support BEAM buckles overnight" },
  { source: "Skyline Report", text: "Engineers dispute cause: was it really the BEAM?" }
] as const;

const STAGGER = 20;

/** Renders a headline with the word "beam" turned red and struck through. */
const Headline: React.FC<{ text: string; strike: number }> = ({ text, strike }) => {
  const parts = text.split(/(beam)/i);
  return (
    <>
      {parts.map((part, i) => {
        if (part.toLowerCase() !== "beam") {
          return (
            <span key={i} style={{ color: colors.foreground }}>
              {part}
            </span>
          );
        }
        // Red highlight + drawn strikethrough for the mistaken word. The word
        // crossfades from foreground to red as the strike draws in.
        return (
          <span key={i} style={{ position: "relative", display: "inline-block", fontWeight: fonts.weight.black }}>
            {/* foreground copy fading out */}
            <span style={{ color: colors.foreground, opacity: 1 - strike }}>{part}</span>
            {/* red copy fading in, stacked exactly over the first */}
            <span style={{ position: "absolute", left: 0, top: 0, color: colors.red, opacity: strike }}>{part}</span>
            <span
              style={{
                position: "absolute",
                left: 0,
                top: "52%",
                height: 5,
                width: `${strike * 100}%`,
                background: colors.red,
                borderRadius: 3,
                boxShadow: `0 0 12px ${withAlpha("red", 0.7)}`
              }}
            />
          </span>
        );
      })}
    </>
  );
};

export const HeadlineMontage: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Final "COLUMN" stamp appears after the headlines have settled.
  const stampStart = HEADLINES.length * STAGGER + 44;
  const stamp = spring({ frame: frame - stampStart, fps, config: { damping: 12, mass: 0.8 }, durationInFrames: 24 });
  const stampScale = interpolate(stamp, [0, 1], [1.6, 1]);
  const stampGlow = interpolate(frame, [stampStart, stampStart + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <AbsoluteFill
      style={{
        padding: SAFE_MARGIN,
        fontFamily: fonts.family,
        justifyContent: "center"
      }}
    >
      <div
        style={{
          fontSize: type.label,
          letterSpacing: 6,
          textTransform: "uppercase",
          color: colors.cyan,
          fontWeight: fonts.weight.semibold,
          marginBottom: 26
        }}
      >
        The headlines all said the same thing
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {HEADLINES.map((h, i) => {
          const start = i * STAGGER;
          const enter = spring({ frame: frame - start, fps, config: { damping: 200 }, durationInFrames: 24 });
          const fromLeft = i % 2 === 0;
          const x = interpolate(enter, [0, 1], [fromLeft ? -220 : 220, 0]);
          // Strikethrough draws once the card has arrived.
          const strike = spring({
            frame: frame - start - 20,
            fps,
            config: { damping: 200 },
            durationInFrames: 22
          });
          return (
            <div
              key={i}
              style={{
                opacity: enter,
                transform: `translateX(${x}px)`,
                background: colors.surface,
                border: `1px solid ${withAlpha("comment", 0.35)}`,
                borderRadius: 16,
                padding: "22px 32px",
                boxShadow: shadow.soft,
                display: "flex",
                flexDirection: "column",
                gap: 8
              }}
            >
              <div
                style={{
                  fontSize: type.caption,
                  color: colors.comment,
                  fontWeight: fonts.weight.semibold,
                  letterSpacing: 1
                }}
              >
                {h.source}
              </div>
              <div style={{ fontSize: type.heading, fontWeight: fonts.weight.semibold, lineHeight: 1.1 }}>
                <Headline text={h.text} strike={strike} />
              </div>
            </div>
          );
        })}
      </div>

      {/* The correction: it was never a beam. */}
      <div
        style={{
          marginTop: 40,
          display: "flex",
          alignItems: "baseline",
          gap: 24,
          opacity: stamp
        }}
      >
        <span style={{ fontSize: type.subheading, color: colors.foreground, fontWeight: fonts.weight.regular }}>
          It was a
        </span>
        <span
          style={{
            fontSize: type.title,
            fontWeight: fonts.weight.black,
            color: colors.purple,
            letterSpacing: 4,
            transform: `scale(${stampScale})`,
            transformOrigin: "left center",
            display: "inline-block",
            textShadow: `0 0 ${28 * stampGlow}px ${withAlpha("purple", 0.7 * stampGlow)}`
          }}
        >
          COLUMN.
        </span>
      </div>
    </AbsoluteFill>
  );
};
