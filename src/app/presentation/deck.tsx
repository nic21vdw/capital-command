"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Download, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PROJECTS } from "./projects";

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

  const [downloading, setDownloading] = useState(false);

  // Renders the active slide server-side (Remotion) and downloads the MP4.
  // The render takes a few seconds, so drive it off a toast with progress.
  const downloadSlide = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    const toastId = toast.loading(`Rendering “${slide.title}” — this can take a few seconds…`);
    try {
      const url = `/api/presentation/render?project=${encodeURIComponent(project.id)}&slide=${encodeURIComponent(slide.id)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? `Render failed (${res.status})`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${project.id}-${slide.id}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      toast.success(`Downloaded “${slide.title}”`, { id: toastId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Render failed", { id: toastId });
    } finally {
      setDownloading(false);
    }
  }, [downloading, project.id, slide.id, slide.title]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--accent)]">Segment Deck</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">{project.name}</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{project.description}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={downloadSlide}
            disabled={downloading}
            title="Render this segment as an MP4 and download it"
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition",
              "border-[var(--accent)] text-white hover:bg-white/8",
              "disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 text-[var(--accent)]" />}
            {downloading ? "Rendering…" : "Download MP4"}
          </button>
          <p className="text-xs text-[var(--muted-foreground)]">
            Slide {index + 1} / {slides.length} · ← → navigate · Space or click video to play/pause
          </p>
        </div>
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
