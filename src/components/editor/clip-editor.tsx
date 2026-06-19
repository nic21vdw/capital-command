"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Crop, Layers, ListMusic, Pause, Play, Save, Sparkles, SquarePen, Subtitles, Type, Upload } from "lucide-react";
import { toast } from "sonner";
import { useAppData } from "@/components/providers/app-provider";
import { chunkWords, serializeSrt, serializeVtt, splitSegment, mergeSegments, windowSegments } from "@/lib/clipping/captions";
import { formatClock } from "@/lib/clipping/editor";
import { Button } from "@/components/ui/button";
import { EditorPreview } from "@/components/editor/preview";
import { EditorTimeline } from "@/components/editor/timeline";
import {
  AudioPanel,
  CaptionsPanel,
  ExportPanel,
  OverlaysPanel,
  ReframePanel,
  StylePanel,
  SuggestionsPanel,
  TranscriptPanel
} from "@/components/editor/panels";
import { cn } from "@/lib/utils";
import type { CaptionSegment, ClipProject, Overlay, OverlayKind, SuggestionStatus } from "@/types/domain";
import type { EditorApi, ExportUiState } from "@/components/editor/types";

const TABS = [
  { id: "captions", label: "Captions", icon: Subtitles },
  { id: "transcript", label: "Transcript", icon: Type },
  { id: "style", label: "Style", icon: SquarePen },
  { id: "reframe", label: "Reframe", icon: Crop },
  { id: "overlays", label: "Overlays", icon: Layers },
  { id: "audio", label: "Audio", icon: ListMusic },
  { id: "suggestions", label: "AI", icon: Sparkles },
  { id: "export", label: "Export", icon: Upload }
] as const;

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function ClipEditor({ initialProject, onClose }: { initialProject: ClipProject; onClose: () => void }) {
  const { mutate } = useAppData();
  const [project, setProject] = useState<ClipProject>(initialProject);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("captions");
  const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [fetchingCaptions, setFetchingCaptions] = useState(false);
  const [exportState, setExportState] = useState<ExportUiState>({ status: "idle", progress: 0 });
  const [saved, setSaved] = useState(true);
  const [saving, setSaving] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoSrc = `/api/clips/${project.jobId}/files/${encodeURIComponent(project.sourceFile)}`;
  const duration = project.baseDurationSec;

  // Track playback time with rAF for smooth caption/word highlighting.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) setTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Debounced autosave so every edit survives a refresh.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setSaved(false);
    const timer = setTimeout(() => {
      void mutate("upsertClipProject", { ...project, updatedAt: new Date().toISOString() }).then(() => setSaved(true));
    }, 700);
    return () => clearTimeout(timer);
  }, [project, mutate]);

  const patch = useCallback((partial: Partial<ClipProject>) => {
    setProject((prev) => ({ ...prev, ...partial }));
  }, []);

  // Explicit save so you can lock in progress on demand instead of waiting for autosave.
  const saveNow = useCallback(async () => {
    setSaving(true);
    try {
      await mutate("upsertClipProject", { ...project, updatedAt: new Date().toISOString() });
      setSaved(true);
      toast.success("Project saved to Projects.");
    } catch {
      toast.error("Could not save the project. Try again.");
    } finally {
      setSaving(false);
    }
  }, [project, mutate]);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    const clamped = Math.max(0, Math.min(duration, t));
    if (v) v.currentTime = clamped;
    setTime(clamped);
  }, [duration]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // A missing/unsupported source rejects this promise; swallow it so it does
      // not surface as an uncaught NotSupportedError in the dev overlay.
      v.play()
        .then(() => setPlaying(true))
        .catch(() => {
          setPlaying(false);
          toast.error("This clip's video could not be played. The rendered file may be missing.");
        });
    } else {
      v.pause();
      setPlaying(false);
    }
  }, []);

  // --- Caption operations ---
  const updateCaption = useCallback((id: string, partial: Partial<CaptionSegment>) => {
    setProject((p) => ({ ...p, captions: p.captions.map((c) => (c.id === id ? { ...c, ...partial } : c)) }));
  }, []);

  const regenerateCaptions = useCallback(async () => {
    setFetchingCaptions(true);
    try {
      const res = await fetch(`/api/clips/${project.jobId}/captions`, { method: "POST" });
      const data = (await res.json()) as { captions?: CaptionSegment[]; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not fetch automatic captions.");
        return;
      }
      const windowed = windowSegments(data.captions ?? [], project.clipStart, project.clipEnd);
      const words = windowed.flatMap((s) => s.words);
      const rechunked = words.length ? chunkWords(words, project.captionStyle.maxWordsPerCaption) : windowed;
      patch({ captions: rechunked });
      toast.success(`Loaded ${rechunked.length} caption segments.`);
    } catch {
      toast.error("Caption request failed.");
    } finally {
      setFetchingCaptions(false);
    }
  }, [project.jobId, project.clipStart, project.clipEnd, project.captionStyle.maxWordsPerCaption, patch]);

  const addCaption = useCallback(() => {
    const start = time;
    const seg: CaptionSegment = { id: uid("cap"), start, end: Math.min(duration, start + 2), text: "New caption", words: [], enabled: true };
    setProject((p) => ({ ...p, captions: [...p.captions, seg].sort((a, b) => a.start - b.start) }));
    setSelectedCaptionId(seg.id);
  }, [time, duration]);

  const splitCaption = useCallback((id: string) => {
    setProject((p) => {
      const idx = p.captions.findIndex((c) => c.id === id);
      if (idx < 0) return p;
      const seg = p.captions[idx];
      if (time <= seg.start || time >= seg.end) {
        toast.error("Move the playhead inside the caption to split it.");
        return p;
      }
      const [a, b] = splitSegment(seg, time);
      return { ...p, captions: [...p.captions.slice(0, idx), a, b, ...p.captions.slice(idx + 1)] };
    });
  }, [time]);

  const mergeCaptionWithNext = useCallback((id: string) => {
    setProject((p) => {
      const idx = p.captions.findIndex((c) => c.id === id);
      if (idx < 0 || idx >= p.captions.length - 1) return p;
      const merged = mergeSegments(p.captions[idx], p.captions[idx + 1]);
      return { ...p, captions: [...p.captions.slice(0, idx), merged, ...p.captions.slice(idx + 2)] };
    });
  }, []);

  const deleteCaption = useCallback((id: string) => {
    setProject((p) => ({ ...p, captions: p.captions.filter((c) => c.id !== id) }));
  }, []);

  const toggleCaption = useCallback((id: string) => {
    setProject((p) => ({ ...p, captions: p.captions.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)) }));
  }, []);

  // --- Overlay operations ---
  const addOverlay = useCallback((kind: OverlayKind, src?: string) => {
    const overlay: Overlay = {
      id: uid("ov"),
      kind,
      text: kind === "text" || kind === "title" ? (kind === "title" ? "Title" : "Text") : undefined,
      src,
      x: 0.5,
      y: kind === "watermark" ? 0.9 : 0.5,
      scale: kind === "watermark" ? 0.5 : 1,
      rotation: 0,
      opacity: kind === "watermark" ? 0.6 : 1,
      z: project.overlays.length,
      locked: false,
      start: 0,
      end: kind === "title" ? Math.min(duration, 3) : duration,
      color: "#ffffff",
      fontWeight: kind === "title" ? 800 : 600,
      align: "center"
    };
    setProject((p) => ({ ...p, overlays: [...p.overlays, overlay] }));
    setSelectedOverlayId(overlay.id);
    setTab("overlays");
  }, [project.overlays.length, duration]);

  const updateOverlay = useCallback((id: string, partial: Partial<Overlay>) => {
    setProject((p) => ({ ...p, overlays: p.overlays.map((o) => (o.id === id ? { ...o, ...partial } : o)) }));
  }, []);

  const deleteOverlay = useCallback((id: string) => {
    setProject((p) => ({ ...p, overlays: p.overlays.filter((o) => o.id !== id) }));
    setSelectedOverlayId((cur) => (cur === id ? null : cur));
  }, []);

  const duplicateOverlay = useCallback((id: string) => {
    setProject((p) => {
      const o = p.overlays.find((x) => x.id === id);
      if (!o) return p;
      const copy = { ...o, id: uid("ov"), x: Math.min(1, o.x + 0.05), y: Math.min(1, o.y + 0.05), z: p.overlays.length };
      return { ...p, overlays: [...p.overlays, copy] };
    });
  }, []);

  const reorderOverlay = useCallback((id: string, direction: "up" | "down") => {
    setProject((p) => ({
      ...p,
      overlays: p.overlays.map((o) => (o.id === id ? { ...o, z: o.z + (direction === "up" ? 1 : -1) } : o))
    }));
  }, []);

  // --- Suggestions ---
  const setSuggestionStatus = useCallback((id: string, status: SuggestionStatus) => {
    setProject((p) => ({ ...p, suggestions: p.suggestions.map((s) => (s.id === id ? { ...s, status } : s)) }));
  }, []);

  const trimSuggestion = useCallback((id: string, start: number, end: number) => {
    setProject((p) => ({ ...p, suggestions: p.suggestions.map((s) => (s.id === id ? { ...s, start, end } : s)) }));
  }, []);

  const addSuggestionToTimeline = useCallback((id: string) => {
    setProject((p) => {
      const s = p.suggestions.find((x) => x.id === id);
      if (!s) return p;
      const overlay: Overlay = {
        id: uid("ov"),
        kind: "title",
        text: "Suggested moment",
        x: 0.5,
        y: 0.15,
        scale: 1,
        rotation: 0,
        opacity: 0.9,
        z: p.overlays.length,
        locked: false,
        start: s.start,
        end: Math.min(p.baseDurationSec, s.start + 2.5),
        color: "#ffd34d",
        fontWeight: 800,
        align: "center"
      };
      toast.success("Suggestion marked on the timeline.");
      return {
        ...p,
        overlays: [...p.overlays, overlay],
        suggestions: p.suggestions.map((x) => (x.id === id ? { ...x, status: "approved", addedToTimeline: true } : x))
      };
    });
  }, []);

  // --- Transcript -> clip ---
  const createClipFromRange = useCallback((start: number, end: number) => {
    seek(start);
    toast.success(`Marked clip ${formatClock(start)}–${formatClock(end)}. Set export trim or add a title to anchor it.`);
    const overlay: Overlay = {
      id: uid("ov"),
      kind: "title",
      text: "Clip start",
      x: 0.5,
      y: 0.12,
      scale: 0.8,
      rotation: 0,
      opacity: 0.85,
      z: project.overlays.length,
      locked: false,
      start,
      end: Math.min(duration, start + 2),
      color: "#7c5cff",
      fontWeight: 800,
      align: "center"
    };
    setProject((p) => ({ ...p, overlays: [...p.overlays, overlay] }));
  }, [seek, duration, project.overlays.length]);

  // --- Export ---
  const downloadSubtitles = useCallback((format: "srt" | "vtt") => {
    const text = format === "srt" ? serializeSrt(project.captions) : serializeVtt(project.captions);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.exportSettings.filename || "clip"}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [project.captions, project.exportSettings.filename]);

  const runExport = useCallback(async () => {
    setExportState({ status: "starting", progress: 0 });
    try {
      // Persist first so the server export reads the latest edit instructions.
      await mutate("upsertClipProject", { ...project, updatedAt: new Date().toISOString() });
      const res = await fetch(`/api/clips/${project.jobId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(project)
      });
      const data = (await res.json()) as { export?: { id: string }; error?: string };
      if (!res.ok || !data.export) {
        setExportState({ status: "error", progress: 0, error: data.error ?? "Export could not start." });
        return;
      }
      setExportState({ status: "processing", progress: 1, exportId: data.export.id });
    } catch {
      setExportState({ status: "error", progress: 0, error: "Export request failed." });
    }
  }, [project, mutate]);

  // Poll the export until it finishes.
  useEffect(() => {
    if (exportState.status !== "processing" || !exportState.exportId) return;
    const id = exportState.exportId;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/clips/${project.jobId}/export/${id}`, { cache: "no-store" });
        const data = (await res.json()) as { export?: { status: string; progress: number; file?: string; error?: string } };
        const rec = data.export;
        if (!rec) return;
        if (rec.status === "done") {
          setExportState({ status: "done", progress: 100, exportId: id, file: rec.file });
          toast.success("Export complete.");
        } else if (rec.status === "error") {
          setExportState({ status: "error", progress: 0, error: rec.error });
        } else {
          setExportState((s) => ({ ...s, progress: rec.progress }));
        }
      } catch {
        /* keep polling */
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [exportState.status, exportState.exportId, project.jobId]);

  const api: EditorApi = {
    project,
    time,
    seek,
    patch,
    fetchingCaptions,
    regenerateCaptions,
    addCaption,
    updateCaption,
    deleteCaption,
    splitCaption,
    mergeCaptionWithNext,
    toggleCaption,
    selectedCaptionId,
    setSelectedCaptionId,
    search,
    setSearch,
    createClipFromRange,
    addOverlay,
    updateOverlay,
    deleteOverlay,
    duplicateOverlay,
    reorderOverlay,
    selectedOverlayId,
    setSelectedOverlayId,
    setSuggestionStatus,
    trimSuggestion,
    addSuggestionToTimeline,
    exportState,
    runExport,
    downloadSubtitles
  };

  const renderPanel = () => {
    switch (tab) {
      case "captions":
        return <CaptionsPanel api={api} />;
      case "transcript":
        return <TranscriptPanel api={api} />;
      case "style":
        return <StylePanel api={api} />;
      case "reframe":
        return <ReframePanel api={api} />;
      case "overlays":
        return <OverlaysPanel api={api} />;
      case "audio":
        return <AudioPanel api={api} />;
      case "suggestions":
        return <SuggestionsPanel api={api} />;
      case "export":
        return <ExportPanel api={api} />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          onClick={() => {
            // Flush any pending edits before leaving so nothing is lost on navigation.
            void (saved ? Promise.resolve() : saveNow()).then(onClose);
          }}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Projects
        </Button>
        <input
          value={project.name}
          onChange={(e) => patch({ name: e.target.value })}
          className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-lg font-semibold text-white outline-none hover:border-[var(--border)] focus:border-[var(--accent)]"
        />
        <span className={cn("flex items-center gap-1.5 text-xs", saved ? "text-emerald-300" : "text-[var(--muted-foreground)]")}>
          <span className={cn("h-1.5 w-1.5 rounded-full", saved ? "bg-emerald-300" : "bg-amber-300")} />
          {saved ? "All changes saved" : "Unsaved changes"}
        </span>
        <Button onClick={() => void saveNow()} disabled={saving || saved}>
          <Save className="mr-2 h-4 w-4" /> {saving ? "Saving…" : saved ? "Saved" : "Save"}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        {/* Left: preview + transport + timeline */}
        <div className="space-y-3">
          <EditorPreview
            project={project}
            time={time}
            videoSrc={videoSrc}
            onVideoReady={(el) => {
              videoRef.current = el;
              if (el) {
                el.onplay = () => setPlaying(true);
                el.onpause = () => setPlaying(false);
              }
            }}
            selectedOverlayId={selectedOverlayId}
            onSelectOverlay={setSelectedOverlayId}
            onOverlayChange={updateOverlay}
          />
          <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <button type="button" onClick={togglePlay} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)]">
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <span className="font-mono text-sm text-white">{formatClock(time)}</span>
            <span className="text-sm text-[var(--muted-foreground)]">/ {formatClock(duration)}</span>
            <input
              type="range"
              min={0}
              max={duration}
              step={0.01}
              value={time}
              onChange={(e) => seek(Number(e.target.value))}
              className="ml-2 h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-[var(--accent)]"
            />
          </div>
          <EditorTimeline
            project={project}
            time={time}
            duration={duration}
            onSeek={seek}
            selectedCaptionId={selectedCaptionId}
            onSelectCaption={setSelectedCaptionId}
            onCaptionChange={updateCaption}
            selectedOverlayId={selectedOverlayId}
            onSelectOverlay={setSelectedOverlayId}
            onOverlayChange={updateOverlay}
          />
        </div>

        {/* Right: tabbed editing panels */}
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition",
                    tab === t.id ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "text-[var(--muted-foreground)] hover:bg-white/5 hover:text-white"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">{renderPanel()}</div>
        </div>
      </div>
    </div>
  );
}
