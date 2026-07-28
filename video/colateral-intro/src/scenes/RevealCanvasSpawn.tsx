import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Beamy } from "../components/Beamy";
import { Wordmark } from "../components/Wordmark";
import { Eyebrow, Tagline } from "../components/Type";
import { theme, copy, fontFamily } from "../theme";

/**
 * Reveal 4 — "Canvas Spawn" (6.5s). The product-led open: the reveal explains
 * what CoLateral IS before the name lands.
 *
 * Real tool cards spawn across the Project Canvas, link themselves together
 * into a source-tied load path, then converge into the centre and resolve as
 * the wordmark. Beamy inspects the canvas, then approves it.
 *
 * Card names are real entries from the app's tool manifest, so the B-roll
 * never shows a tool that doesn't exist.
 */

type Card = {
  label: string;
  kind: string;
  x: number;
  y: number;
  at: number; // spawn frame
};

const CARDS: Card[] = [
  { label: "Quick Beam", kind: "Design checker", x: 300, y: 250, at: 8 },
  { label: "Climatic Data", kind: "Reference data", x: 1370, y: 210, at: 16 },
  { label: "Steel Beam Designer", kind: "Design checker", x: 1440, y: 560, at: 24 },
  { label: "Steel Connection Capacity", kind: "Design checker", x: 330, y: 640, at: 32 },
  { label: "Concrete Wall Designer", kind: "Design checker", x: 840, y: 810, at: 40 },
  { label: "Helical Pile Foundation", kind: "Design checker", x: 880, y: 150, at: 48 },
];

/** Which cards wire to which, as index pairs. */
const LINKS: [number, number][] = [
  [0, 5],
  [5, 1],
  [0, 3],
  [3, 4],
  [4, 2],
  [1, 2],
];

const CONVERGE = 92; // frame the canvas collapses into the wordmark

export const RevealCanvasSpawn: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // everything pulls toward centre and fades as the mark takes over
  const collapse = spring({ frame: frame - CONVERGE, fps, config: { damping: 19 } });

  const styleFor = (i: number) => {
    const s = spring({
      frame: frame - (CONVERGE + 12) - i * 2.5,
      fps,
      config: { damping: 13, mass: 0.5 },
    });
    return {
      opacity: s,
      transform: `translateY(${interpolate(s, [0, 1], [30, 0])}px) scale(${interpolate(
        s,
        [0, 1],
        [0.9, 1],
      )})`,
      filter: `blur(${interpolate(s, [0, 1], [8, 0])}px)`,
    };
  };

  const eyebrow = spring({ frame: frame - (CONVERGE + 34), fps, config: { damping: 18 } });
  const tagline = spring({ frame: frame - (CONVERGE + 46), fps, config: { damping: 18 } });

  /** A card's live position, pulled toward centre once the canvas collapses. */
  const posOf = (c: Card) => ({
    x: interpolate(collapse, [0, 1], [c.x, 960]),
    y: interpolate(collapse, [0, 1], [c.y, 540]),
  });

  const cardIn = (c: Card) =>
    spring({ frame: frame - c.at, fps, config: { damping: 14, mass: 0.6 } });

  return (
    <AbsoluteFill>
      <Backdrop grid={0.9} pitch={30} />

      {/* --- link lines between cards --- */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {LINKS.map(([a, b], i) => {
          const ca = CARDS[a];
          const cb = CARDS[b];
          const appear = spring({
            frame: frame - Math.max(ca.at, cb.at) - 8,
            fps,
            config: { damping: 20 },
          });
          if (appear <= 0.001) return null;
          const pa = posOf(ca);
          const pb = posOf(cb);
          return (
            <line
              key={i}
              x1={pa.x}
              y1={pa.y}
              x2={interpolate(appear, [0, 1], [pa.x, pb.x])}
              y2={interpolate(appear, [0, 1], [pa.y, pb.y])}
              stroke={theme.brand}
              strokeWidth={2}
              opacity={0.4 * (1 - collapse)}
              strokeDasharray="7 7"
            />
          );
        })}
      </svg>

      {/* --- tool cards --- */}
      {CARDS.map((c, i) => {
        const p = cardIn(c);
        if (p <= 0.001) return null;
        const pos = posOf(c);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: pos.x,
              top: pos.y,
              transform: `translate(-50%, -50%) scale(${
                interpolate(p, [0, 1], [0.6, 1]) * interpolate(collapse, [0, 1], [1, 0.35])
              })`,
              opacity: p * (1 - collapse),
              width: 322,
              padding: "18px 20px",
              borderRadius: 14,
              background: theme.s1,
              border: `1px solid ${theme.bd2}`,
              boxShadow: "0 18px 44px rgba(0,0,0,.55)",
              fontFamily,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: theme.brand,
                  boxShadow: `0 0 10px ${theme.brand}`,
                }}
              />
              <div style={{ color: theme.tx, fontSize: 21, fontWeight: 650 }}>{c.label}</div>
            </div>
            <div
              style={{
                color: theme.tx3,
                fontSize: 15,
                letterSpacing: "0.13em",
                textTransform: "uppercase",
                fontWeight: 600,
                marginBottom: 12,
              }}
            >
              {c.kind}
            </div>
            {/* mini result rows */}
            {[0.86, 0.62].map((wRatio, r) => (
              <div
                key={r}
                style={{
                  height: 7,
                  width: `${wRatio * 100}%`,
                  borderRadius: 4,
                  background: r === 0 ? "rgba(189,147,249,.35)" : theme.bd2,
                  marginTop: 8,
                }}
              />
            ))}
            <div
              style={{
                marginTop: 14,
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                color: theme.green,
                fontSize: 15,
                fontWeight: 650,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: theme.green,
                  display: "inline-block",
                }}
              />
              Passes
            </div>
          </div>
        );
      })}

      {/* --- Beamy watching the canvas --- */}
      <div
        style={{
          position: "absolute",
          left: 900,
          top: 470,
          opacity: spring({ frame: frame - 56, fps, config: { damping: 14 } }) * (1 - collapse),
        }}
      >
        <Beamy
          size={168}
          mood={frame > 78 ? "cool" : "happy"}
          action={frame > 78 ? "approve" : "inspect"}
        />
      </div>

      {/* --- the wordmark the canvas resolves into --- */}
      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center", flexDirection: "column" }}
      >
        <Wordmark fontSize={176} styleFor={styleFor} />
        <Eyebrow
          fontSize={24}
          style={{
            marginTop: 22,
            opacity: eyebrow,
            transform: `translateY(${interpolate(eyebrow, [0, 1], [14, 0])}px)`,
          }}
        >
          {copy.eyebrow}
        </Eyebrow>
        <Tagline
          fontSize={28}
          style={{
            marginTop: 24,
            opacity: tagline,
            transform: `translateY(${interpolate(tagline, [0, 1], [16, 0])}px)`,
          }}
        >
          {copy.tagline}
        </Tagline>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
