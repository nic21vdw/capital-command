"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { AbsoluteFill } from "remotion";
import { ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { VIDEO as BUCKLING_VIDEO } from "@/remotion/theme";
import { TitleComp } from "@/remotion/compositions/TitleComp";
import { HeadlineComp } from "@/remotion/compositions/HeadlineComp";
import { ColumnVsBeamComp } from "@/remotion/compositions/ColumnVsBeamComp";
import { BucklingComp } from "@/remotion/compositions/BucklingComp";
import { CausesComp } from "@/remotion/compositions/CausesComp";
import { COLOR_BG as SIGNAL_BG, VIDEO as SIGNAL_VIDEO } from "../../../signal-free-ai-builds/src/theme";
import { ColdOpenTitle } from "../../../signal-free-ai-builds/src/scenes/ColdOpenTitle";
import { CommentCTA } from "../../../signal-free-ai-builds/src/scenes/CommentCTA";
import { EndCard } from "../../../signal-free-ai-builds/src/scenes/EndCard";
import { SeriesLogo } from "../../../signal-free-ai-builds/src/components/SeriesLogo";
import { LowerThird } from "../../../signal-free-ai-builds/src/components/LowerThird";
import { ColdOpenTitle as VibeColdOpenTitle } from "../../../video/vibe-coding-first-steps/src/scenes/ColdOpenTitle";
import { TierList as VibeTierList } from "../../../video/vibe-coding-first-steps/src/scenes/TierList";
import { TheMove as VibeTheMove } from "../../../video/vibe-coding-first-steps/src/scenes/TheMove";
import { ByTheWay as VibeByTheWay } from "../../../video/vibe-coding-first-steps/src/scenes/ByTheWay";
import { EndCard as VibeEndCard } from "../../../video/vibe-coding-first-steps/src/scenes/EndCard";
import { ColdOpenHook as AirColdOpenHook } from "../../../video/ai-industrial-revolution/src/scenes/ColdOpenHook";
import { ThenVsNow as AirThenVsNow } from "../../../video/ai-industrial-revolution/src/scenes/ThenVsNow";
import { StepOne as AirStepOne } from "../../../video/ai-industrial-revolution/src/scenes/StepOne";
import { ModelPicker as AirModelPicker } from "../../../video/ai-industrial-revolution/src/scenes/ModelPicker";
import { EndCard as AirEndCard } from "../../../video/ai-industrial-revolution/src/scenes/EndCard";
import { VIDEO as CLAUDE_TRAILER_VIDEO } from "../../../video/claude-trailer/src/theme";
import { LogoReveal as ClaudeLogoReveal } from "../../../video/claude-trailer/src/scenes/LogoReveal";
import { HardestProblems as ClaudeHardestProblems } from "../../../video/claude-trailer/src/scenes/HardestProblems";
import { Capabilities as ClaudeCapabilities } from "../../../video/claude-trailer/src/scenes/Capabilities";
import { Momentum as ClaudeMomentum } from "../../../video/claude-trailer/src/scenes/Momentum";
import { EndCard as ClaudeEndCard } from "../../../video/claude-trailer/src/scenes/EndCard";

type Slide = {
  id: string;
  title: string;
  note: string;
  component: React.FC;
  durationInFrames: number;
};

type Project = {
  id: string;
  name: string;
  description: string;
  format: { width: number; height: number; fps: number };
  slides: Slide[];
};

// Overlay scenes (logo, lower third, CTA, end card) render transparent on
// their own — stage them on the series background like the Remotion Root does.
const onSignalStage = (Scene: React.FC): React.FC =>
  function Staged() {
    return (
      <AbsoluteFill style={{ backgroundColor: SIGNAL_BG }}>
        <Scene />
      </AbsoluteFill>
    );
  };

const PROJECTS: Project[] = [
  {
    id: "column-buckling",
    name: "Manhattan Column Buckling",
    description: "Explainer diagram segments · 1920×1080",
    format: BUCKLING_VIDEO,
    slides: [
      { id: "TitleComp", title: "Title", note: "Animated title reveal + lower third", component: TitleComp, durationInFrames: 4 * BUCKLING_VIDEO.fps },
      { id: "HeadlineComp", title: "Headlines", note: "“beam” struck through, “COLUMN” stamp", component: HeadlineComp, durationInFrames: 6 * BUCKLING_VIDEO.fps },
      { id: "ColumnVsBeamComp", title: "Column vs Beam", note: "Buckle vs sag, side by side", component: ColumnVsBeamComp, durationInFrames: 8 * BUCKLING_VIDEO.fps },
      { id: "BucklingComp", title: "Euler Buckling", note: "Straight, then S-curve past P_cr", component: BucklingComp, durationInFrames: 6 * BUCKLING_VIDEO.fps },
      { id: "CausesComp", title: "Four Causes", note: "Sequenced cause cards, 3s each", component: CausesComp, durationInFrames: 12 * BUCKLING_VIDEO.fps }
    ]
  },
  {
    id: "free-ai-builds",
    name: "Free AI Builds",
    description: "Signal series inserts · 1080×1920 vertical",
    format: SIGNAL_VIDEO,
    slides: [
      { id: "ColdOpenTitle", title: "Cold Open Title", note: "3s wordmark reveal over glow pulse", component: ColdOpenTitle, durationInFrames: 90 },
      { id: "SeriesLogo", title: "Series Logo", note: "2s spark mark + wordmark card", component: onSignalStage(() => <SeriesLogo />), durationInFrames: 60 },
      {
        id: "LowerThird",
        title: "Lower Third",
        note: "Reusable name/title slide-in card",
        component: onSignalStage(() => <LowerThird name="Nic Vandewetering" subtitle="Structural Engineer, Building CoLateral" />),
        durationInFrames: 100
      },
      { id: "CommentCTA", title: "Comment CTA", note: "4s comment call-to-action", component: onSignalStage(CommentCTA), durationInFrames: 120 },
      { id: "EndCard", title: "End Card", note: "3s series end card", component: onSignalStage(EndCard), durationInFrames: 90 }
    ]
  },
  {
    id: "vibe-coding-first-steps",
    name: "Vibe Coding: First Steps",
    description: "Vibe Coding series, episode 1 · 1080×1920 vertical",
    format: { width: 1080, height: 1920, fps: 30 },
    slides: [
      { id: "ColdOpenTitle", title: "Cold Open Title", note: "“How to start vibe coding — in the simplest terms”", component: VibeColdOpenTitle, durationInFrames: 90 },
      { id: "TierList", title: "Tier List", note: "Gemini BAD · ChatGPT OKAY · Claude GOOD", component: VibeTierList, durationInFrames: 210 },
      { id: "TheMove", title: "The Move", note: "“Buy the $20 account” → GOOD", component: VibeTheMove, durationInFrames: 120 },
      { id: "ByTheWay", title: "By The Way", note: "“You don’t need to know how to code” → GOOD", component: VibeByTheWay, durationInFrames: 120 },
      { id: "EndCard", title: "End Card", note: "“That’s step 1” → next: your first prompt", component: VibeEndCard, durationInFrames: 120 }
    ]
  },
  {
    id: "ai-industrial-revolution",
    name: "AI: The New Industrial Revolution",
    description: "Series hook/intro · 1080×1920 vertical",
    format: { width: 1080, height: 1920, fps: 30 },
    slides: [
      { id: "ColdOpenHook", title: "Cold Open Hook", note: "“AI is the new industrial revolution — of modern times”", component: AirColdOpenHook, durationInFrames: 90 },
      { id: "ThenVsNow", title: "Then vs Now", note: "1800s steam vs today’s AI — same shift, new century", component: AirThenVsNow, durationInFrames: 180 },
      { id: "StepOne", title: "Step 1", note: "“Choose the right model” — the one instruction", component: AirStepOne, durationInFrames: 150 },
      { id: "ModelPicker", title: "Model Picker", note: "Match the model to the job: fast · balanced · big brain", component: AirModelPicker, durationInFrames: 210 },
      { id: "EndCard", title: "End Card", note: "“That’s step 1” → next: put it to work", component: AirEndCard, durationInFrames: 120 }
    ]
  },
  {
    id: "claude-trailer",
    name: "Claude Trailer",
    description: "20s voiceover bed · 1920×1080 · Anthropic palette + starburst mark",
    format: CLAUDE_TRAILER_VIDEO,
    slides: [
      { id: "LogoReveal", title: "Logo Reveal", note: "Starburst spins up with pulse rings → Claude wordmark", component: ClaudeLogoReveal, durationInFrames: 120 },
      { id: "HardestProblems", title: "Hardest Problems", note: "“BUILT FOR THE HARDEST PROBLEMS”, word by word", component: ClaudeHardestProblems, durationInFrames: 140 },
      { id: "Capabilities", title: "Capabilities", note: "1M context · frontier reasoning · agentic cards", component: ClaudeCapabilities, durationInFrames: 160 },
      { id: "Momentum", title: "Momentum", note: "“Think deeper. Ship faster.” + spark comet sweep", component: ClaudeMomentum, durationInFrames: 90 },
      { id: "EndCard", title: "End Card", note: "Pulsing spark + wordmark → claude.ai", component: ClaudeEndCard, durationInFrames: 90 }
    ]
  }
];

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * A keyboard-navigable deck of Remotion segments, grouped by the project each
 * video belongs to. Each slide embeds its composition in a <Player> that
 * auto-plays the moment the slide becomes active — the Player is keyed by
 * project + slide so it remounts and restarts from frame 0 on every change.
 */
export const PresentationDeck: React.FC = () => {
  const [projectId, setProjectId] = useState(PROJECTS[0].id);
  const [index, setIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const playerRef = useRef<PlayerRef>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const project = useMemo(() => PROJECTS.find((p) => p.id === projectId) ?? PROJECTS[0], [projectId]);
  const slides = project.slides;
  const slide = slides[Math.min(index, slides.length - 1)];
  const clamp = useCallback((i: number) => Math.max(0, Math.min(slides.length - 1, i)), [slides.length]);

  const selectProject = (id: string) => {
    setProjectId(id);
    setIndex(0);
    setMenuOpen(false);
  };

  // Close the project dropdown on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") setIndex((i) => clamp(i + 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setIndex((i) => clamp(i - 1));
      if (e.key === " " || e.code === "Space") {
        // Space toggles playback from anywhere on the page (and must not
        // scroll it, or re-trigger a focused button).
        e.preventDefault();
        playerRef.current?.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clamp]);

  const vertical = project.format.height > project.format.width;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--accent)]">Segment Deck</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">{project.name}</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{project.description}</p>
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">
          Slide {index + 1} / {slides.length} · ← → navigate · Space or click video to play/pause
        </p>
      </header>

      {/* Project selector — every video is tied to a project; switch via
          this collapsible dropdown. */}
      <div ref={menuRef} className="relative w-full max-w-md">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          className="flex w-full items-center gap-2 rounded-lg border border-[var(--accent)] bg-white/8 px-3 py-2 text-sm font-medium text-white transition hover:border-[var(--border-strong)]"
        >
          <Clapperboard className="h-4 w-4 text-[var(--accent)]" />
          {project.name}
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px]">{project.slides.length}</span>
          <ChevronDown className={cn("ml-auto h-4 w-4 transition-transform", menuOpen && "rotate-180")} />
        </button>

        {menuOpen && (
          <ul
            role="listbox"
            className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-xl"
          >
            {PROJECTS.map((p) => {
              const active = p.id === project.id;
              return (
                <li key={p.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => selectProject(p.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition",
                      active
                        ? "bg-white/8 font-medium text-white"
                        : "text-[var(--muted-foreground)] hover:bg-white/5 hover:text-white"
                    )}
                  >
                    <Clapperboard className={cn("h-4 w-4", active && "text-[var(--accent)]")} />
                    {p.name}
                    <span className="ml-auto rounded-full bg-white/8 px-2 py-0.5 text-[11px]">{p.slides.length}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-4 xl:flex-row">
        {/* slide rail */}
        <nav className="flex shrink-0 gap-2 overflow-x-auto xl:w-64 xl:flex-col xl:overflow-visible">
          {slides.map((s, i) => {
            const active = i === index;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setIndex(i)}
                className={cn(
                  "min-w-52 rounded-xl border p-3 text-left transition xl:min-w-0",
                  active
                    ? "border-[var(--accent)] bg-white/8"
                    : "border-[var(--border)] bg-[var(--panel)] hover:border-[var(--border-strong)]"
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
                      active ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "bg-white/8 text-[var(--muted-foreground)]"
                    )}
                  >
                    {active ? <Play className="h-3 w-3" /> : i + 1}
                  </span>
                  <span className={cn("text-sm font-medium", active ? "text-white" : "text-[var(--muted-foreground)]")}>{s.title}</span>
                  <span className="ml-auto text-[11px] text-[var(--muted-foreground)]">
                    {(s.durationInFrames / project.format.fps).toFixed(0)}s
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-snug text-[var(--muted-foreground)]">{s.note}</p>
              </button>
            );
          })}
        </nav>

        {/* stage */}
        <main className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-black/60 p-3">
            <Player
              // key remounts the player on project/slide change -> restarts + autoplays
              key={`${project.id}:${slide.id}`}
              ref={playerRef}
              component={slide.component}
              durationInFrames={slide.durationInFrames}
              compositionWidth={project.format.width}
              compositionHeight={project.format.height}
              fps={project.format.fps}
              autoPlay
              loop
              controls
              clickToPlay
              spaceKeyToPlayOrPause={false}
              style={{
                width: "100%",
                maxHeight: "70vh",
                aspectRatio: `${project.format.width} / ${project.format.height}`,
                ...(vertical ? { width: "auto", height: "70vh", maxWidth: "100%" } : {})
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setIndex((i) => clamp(i - 1))}
              disabled={index === 0}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted-foreground)] transition enabled:hover:border-[var(--border-strong)] enabled:hover:text-white disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            <p className="text-sm text-[var(--muted-foreground)]">
              {slide.title} · {(slide.durationInFrames / project.format.fps).toFixed(0)}s · {project.format.width}×{project.format.height}
            </p>
            <button
              type="button"
              onClick={() => setIndex((i) => clamp(i + 1))}
              disabled={index === slides.length - 1}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted-foreground)] transition enabled:hover:border-[var(--border-strong)] enabled:hover:text-white disabled:opacity-40"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </main>
      </div>
    </div>
  );
};
