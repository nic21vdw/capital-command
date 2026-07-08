"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Player } from "@remotion/player";
import { colors, fonts, VIDEO, withAlpha } from "@/remotion/theme";
import { TitleComp } from "@/remotion/compositions/TitleComp";
import { HeadlineComp } from "@/remotion/compositions/HeadlineComp";
import { ColumnVsBeamComp } from "@/remotion/compositions/ColumnVsBeamComp";
import { BucklingComp } from "@/remotion/compositions/BucklingComp";
import { CausesComp } from "@/remotion/compositions/CausesComp";

type Slide = {
  id: string;
  title: string;
  note: string;
  component: React.FC;
  durationInFrames: number;
};

const SLIDES: Slide[] = [
  { id: "TitleComp", title: "Title", note: "Animated title reveal + lower third", component: TitleComp, durationInFrames: 4 * VIDEO.fps },
  { id: "HeadlineComp", title: "Headlines", note: '“beam” struck through, “COLUMN” stamp', component: HeadlineComp, durationInFrames: 6 * VIDEO.fps },
  { id: "ColumnVsBeamComp", title: "Column vs Beam", note: "Buckle vs sag, side by side", component: ColumnVsBeamComp, durationInFrames: 8 * VIDEO.fps },
  { id: "BucklingComp", title: "Euler Buckling", note: "Straight, then S-curve past P_cr", component: BucklingComp, durationInFrames: 6 * VIDEO.fps },
  { id: "CausesComp", title: "Four Causes", note: "Sequenced cause cards, 3s each", component: CausesComp, durationInFrames: 12 * VIDEO.fps }
];

/**
 * A keyboard-navigable slide deck. Each slide embeds the matching Remotion
 * composition in a <Player> that AUTO-PLAYS the moment the slide becomes
 * active — the Player is keyed by slide id so it remounts and restarts from
 * frame 0 on every navigation.
 */
const clamp = (i: number) => Math.max(0, Math.min(SLIDES.length - 1, i));

export const PresentationDeck: React.FC = () => {
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];

  const go = useCallback((next: number) => setIndex(clamp(next)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Functional updates read the latest index without a render-time ref.
      if (e.key === "ArrowRight" || e.key === "PageDown") setIndex((i) => clamp(i + 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setIndex((i) => clamp(i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: colors.background,
        color: colors.foreground,
        fontFamily: fonts.family,
        display: "flex",
        flexDirection: "column",
        padding: 32,
        gap: 24
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 14, letterSpacing: 4, textTransform: "uppercase", color: colors.cyan }}>
            Remotion segment deck
          </div>
          <h1 style={{ margin: "6px 0 0", fontSize: 30, fontWeight: fonts.weight.black }}>
            Manhattan Column Buckling — Explained
          </h1>
        </div>
        <div style={{ fontSize: 14, color: colors.comment }}>
          Slide {index + 1} / {SLIDES.length} · ← → to navigate · auto-plays on view
        </div>
      </header>

      <div style={{ display: "flex", gap: 24, flex: 1, minHeight: 0 }}>
        {/* slide rail */}
        <nav style={{ display: "flex", flexDirection: "column", gap: 10, width: 260 }}>
          {SLIDES.map((s, i) => {
            const active = i === index;
            return (
              <button
                key={s.id}
                onClick={() => go(i)}
                style={{
                  textAlign: "left",
                  cursor: "pointer",
                  padding: "14px 16px",
                  borderRadius: 12,
                  border: `1px solid ${active ? colors.purple : withAlpha("comment", 0.35)}`,
                  background: active ? withAlpha("purple", 0.14) : colors.surface,
                  color: colors.foreground,
                  fontFamily: fonts.family,
                  transition: "border-color .15s, background .15s"
                }}
              >
                <div style={{ fontSize: 15, fontWeight: fonts.weight.black, color: active ? colors.purple : colors.foreground }}>
                  {i + 1}. {s.title}
                </div>
                <div style={{ fontSize: 12, color: colors.comment, marginTop: 4 }}>{s.note}</div>
              </button>
            );
          })}
        </nav>

        {/* stage */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <div
            style={{
              flex: 1,
              borderRadius: 16,
              overflow: "hidden",
              border: `1px solid ${withAlpha("comment", 0.4)}`,
              background: colors.surface,
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <Player
              // key remounts the player on slide change -> restarts + autoplays
              key={slide.id}
              component={slide.component}
              durationInFrames={slide.durationInFrames}
              compositionWidth={VIDEO.width}
              compositionHeight={VIDEO.height}
              fps={VIDEO.fps}
              autoPlay
              loop
              controls
              clickToPlay
              style={{ width: "100%", height: "100%" }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button onClick={() => go(index - 1)} disabled={index === 0} style={navBtn(index === 0)}>
              ← Previous
            </button>
            <div style={{ fontSize: 14, color: colors.comment }}>
              {slide.title} · {(slide.durationInFrames / VIDEO.fps).toFixed(0)}s
            </div>
            <button
              onClick={() => go(index + 1)}
              disabled={index === SLIDES.length - 1}
              style={navBtn(index === SLIDES.length - 1)}
            >
              Next →
            </button>
          </div>
        </main>
      </div>
    </div>
  );
};

function navBtn(disabled: boolean): React.CSSProperties {
  return {
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    padding: "12px 22px",
    borderRadius: 12,
    border: `1px solid ${colors.purple}`,
    background: withAlpha("purple", 0.16),
    color: colors.foreground,
    fontFamily: fonts.family,
    fontWeight: fonts.weight.semibold,
    fontSize: 15
  };
}
