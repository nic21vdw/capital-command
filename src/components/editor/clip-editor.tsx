"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Layers,
  LayoutTemplate,
  ListMusic,
  Pause,
  Play,
  Save,
  Sparkles,
  SquarePen,
  Subtitles,
  Upload,
  Volume2,
  VolumeX
} from "lucide-react";
import { toast } from "sonner";
import { useAppData } from "@/components/providers/app-provider";
import { chunkWords, serializeSrt, serializeVtt, splitSegment, mergeSegments, windowSegments } from "@/lib/clipping/captions";
import { formatClock, generateClipTitle } from "@/lib/clipping/editor";
import { Button } from "@/components/ui/button";
import { EditorPreview } from "@/components/editor/preview";
import { EditorTimeline } from "@/components/editor/timeline";
import {
  AudioPanel,
  CaptionsPanel,
  ExportPanel,
  LayoutPanel,
  OverlaysPanel,
  StylePanel
} from "@/components/editor/panels";
import { cn } from "@/lib/utils";
import type { CaptionSegment, ClipProject, Overlay, OverlayKind } from "@/types/domain";
import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";
import type { EditorApi, ExportUiState } from "@/components/editor/types";

const TABS = [
  { id: "layout", label: "Layout", icon: LayoutTemplate },
  { id: "captions", label: "Captions", icon: Subtitles },
  { id: "style", label: "Style", icon: SquarePen },
  { id: "overlays", label: "Text", icon: Layers },
  { id: "audio", label: "Audio", icon: ListMusic },
  { id: "export", label: "Export", icon: Upload }
] as const;

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function ClipEditor({
  initialProject,
  onClose,
  onOpenClip
}: {
  initialProject: ClipProject;
  onClose: () => void;
  onOpenClip?: (job: ClipJob, clip: ClipCandidate, index: number) => void;
}) {
  const { mutate } = useAppData();
  const [project, setProject] = useState<ClipProject>(initialProject);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("layout");
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [faceCropEditing, setFaceCropEditing] = useState(false);
  const [fetchingCaptions, setFetchingCaptions] = useState(false);
  const [exportState, setExportState] = useState<ExportUiState>({ status: "idle", progress: 0 });
  const [saved, setSaved] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sourceJob, setSourceJob] = useState<ClipJob | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trimEndRef = useRef(0);
  const lastTimeUpdateRef = useRef(0);
  // Mirrors `time` for callbacks that only need the playhead when invoked, so
  // they don't have to be re-created (and re-render memoized children) on
  // every playback frame.
  const timeRef = useRef(0);
  const videoSrc = `/api/clips/${project.jobId}/files/${encodeURIComponent(project.sourceFile)}?project=${encodeURIComponent(project.id)}`;
  const duration = project.baseDurationSec;
  const trimStart = Math.max(0, Math.min(project.trimStart ?? 0, duration));
  const trimEnd = Math.max(trimStart + 0.1, Math.min(project.trimEnd || duration, duration));

  useEffect(() => {
    trimEndRef.current = trimEnd;
  }, [trimEnd]);

  // The clip bin: other detected moments from the same stream, one click away.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/clips/${project.jobId}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const { job } = (await res.json()) as { job: ClipJob };
        if (!cancelled) setSourceJob(job);
      } catch {
        // The bin is optional — the editor works without it.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [project.jobId]);

  // Track playback without re-rendering the whole editor on every animation frame.
  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const v = videoRef.current;
      if (v) {
        const end = trimEndRef.current;
        if (!v.paused && v.currentTime >= end - 0.02) {
          v.pause();
          v.currentTime = end;
          setPlaying(false);
          timeRef.current = end;
          setTime(end);
        } else if (now - lastTimeUpdateRef.current >= 90 || v.paused) {
          lastTimeUpdateRef.current = now;
          timeRef.current = v.currentTime;
          setTime(v.currentTime);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Mirror mute/volume into refs so handleVideoReady can stay identity-stable:
  // if it changed with muted/volume, the preview would re-bind (and previously
  // re-mount) its video elements on every audio tweak.
  const mutedRef = useRef(muted);
  const volumeRef = useRef(volume);
  useEffect(() => {
    mutedRef.current = muted;
    volumeRef.current = volume;
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    v.volume = volume;
  }, [muted, volume]);

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

  // Reads muted/volume through refs so the callback stays stable — otherwise
  // every step of a volume drag would re-run the preview's video-ready effect.
  const handleVideoReady = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el) {
      el.onplay = () => setPlaying(true);
      el.onpause = () => setPlaying(false);
      el.muted = mutedRef.current;
      el.volume = volumeRef.current;
    } else {
      setPlaying(false);
    }
  }, []);

  const handleReframeChange = useCallback((partial: Partial<ClipProject["reframe"]>) => {
    setProject((prev) => ({ ...prev, reframe: { ...prev.reframe, ...partial } }));
  }, []);


  // Explicit save so you can lock in progress on demand instead of waiting for autosave.
  const saveNow = useCallback(async () => {
    setSaving(true);
    try {
      await mutate("upsertClipProject", { ...project, updatedAt: new Date().toISOString() });
      setSaved(true);
      toast.success("Project saved.");
    } catch {
      toast.error("Could not save the project. Try again.");
    } finally {
      setSaving(false);
    }
  }, [project, mutate]);

  const flushThen = useCallback(
    (next: () => void) => {
      void (saved ? Promise.resolve() : saveNow()).then(next);
    },
    [saved, saveNow]
  );

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    const clamped = Math.max(0, Math.min(duration, t));
    if (v) v.currentTime = clamped;
    timeRef.current = clamped;
    setTime(clamped);
  }, [duration]);

  const scrubTo = useCallback((t: number) => {
    const v = videoRef.current;
    const shouldResume = Boolean(v && !v.paused);
    seek(t);
    if (shouldResume && v) {
      requestAnimationFrame(() => {
        void v.play().then(() => setPlaying(true)).catch(() => undefined);
      });
    }
  }, [seek]);

  const setTrim = useCallback((start: number, end: number) => {
    const nextStart = Math.max(0, Math.min(start, duration - 0.1));
    const nextEnd = Math.max(nextStart + 0.1, Math.min(end, duration));
    patch({ trimStart: nextStart, trimEnd: nextEnd });
  }, [duration, patch]);

  const resetTrim = useCallback(() => {
    patch({ trimStart: 0, trimEnd: duration });
  }, [duration, patch]);

  // Split the current selection at the playhead: this project keeps the first
  // half; the second half is saved as its own project so both can be exported.
  const splitAtPlayhead = useCallback(() => {
    const at = timeRef.current;
    if (at <= trimStart + 0.2 || at >= trimEnd - 0.2) {
      toast.error("Move the playhead inside the selection to split.");
      return;
    }
    const now = new Date().toISOString();
    const secondPart: ClipProject = {
      ...project,
      id: `clip-${crypto.randomUUID()}`,
      name: `${project.name} (part 2)`,
      trimStart: at,
      trimEnd,
      createdAt: now,
      updatedAt: now
    };
    patch({ trimEnd: at });
    void mutate("upsertClipProject", secondPart);
    toast.success("Clip split — the second half was saved as its own project.");
  }, [mutate, patch, project, trimEnd, trimStart]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.currentTime < trimStart || v.currentTime >= trimEnd) {
      v.currentTime = trimStart;
      setTime(trimStart);
    }
    v.muted = muted;
    v.volume = volume;
    if (v.paused) {
      // Call play() directly from the user gesture. Waiting for canplay first can
      // lose browser user-activation and make the transport button feel dead.
      // Do not force load() here: it interrupts Chromium's pending play request
      // and leaves the preview paused at 0 while metadata finishes loading.
      v.play()
        .then(() => setPlaying(true))
        .catch((error) => {
          if (v.error) {
            setPlaying(false);
            toast.error("This clip's video could not be played. The rendered file may be missing.");
            return;
          }
          v.muted = true;
          setMuted(true);
          v.play()
            .then(() => {
              setPlaying(true);
              toast.info("Preview started muted. Turn audio back on when you need it.");
            })
            .catch(() => {
              setPlaying(false);
              const message = error instanceof Error ? error.message : String(error ?? "");
              toast.error(message.includes("interrupted") ? "Preview is still loading. Try play again in a moment." : "Preview playback could not start.");
            });
        });
    } else {
      v.pause();
      setPlaying(false);
    }
  }, [muted, trimEnd, trimStart, volume]);

  const generateTitle = useCallback(async () => {
    let captions = project.captions;
    if (captions.length === 0) {
      setFetchingCaptions(true);
      try {
        const res = await fetch(`/api/clips/${project.jobId}/captions`, { method: "POST" });
        const data = (await res.json()) as { captions?: CaptionSegment[]; error?: string };
        if (res.ok) {
          const windowed = windowSegments(data.captions ?? [], project.clipStart, project.clipEnd);
          const words = windowed.flatMap((s) => s.words);
          captions = words.length ? chunkWords(words, project.captionStyle.maxWordsPerCaption) : windowed;
        } else {
          toast.error(data.error ?? "Could not fetch captions for title generation.");
        }
      } finally {
        setFetchingCaptions(false);
      }
    }
    const trimmedCaptions = captions.filter((caption) => caption.end > trimStart && caption.start < trimEnd);
    const title = generateClipTitle(trimmedCaptions.length ? trimmedCaptions : captions, project.name);
    patch({ title, name: title, captions });
    toast.success("Generated clip title.");
  }, [project.captions, project.captionStyle.maxWordsPerCaption, project.clipEnd, project.clipStart, project.jobId, project.name, trimEnd, trimStart, patch]);

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
    const start = timeRef.current;
    const seg: CaptionSegment = { id: uid("cap"), start, end: Math.min(duration, start + 2), text: "New caption", words: [], enabled: true };
    setProject((p) => ({ ...p, captions: [...p.captions, seg].sort((a, b) => a.start - b.start) }));
    setSelectedCaptionId(seg.id);
  }, [duration]);

  const splitCaption = useCallback((id: string) => {
    const at = timeRef.current;
    setProject((p) => {
      const idx = p.captions.findIndex((c) => c.id === id);
      if (idx < 0) return p;
      const seg = p.captions[idx];
      if (at <= seg.start || at >= seg.end) {
        toast.error("Move the playhead inside the caption to split it.");
        return p;
      }
      const [a, b] = splitSegment(seg, at);
      return { ...p, captions: [...p.captions.slice(0, idx), a, b, ...p.captions.slice(idx + 1)] };
    });
  }, []);

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

  // Memoized (and deliberately without the live playhead time) so the panels,
  // which are React.memo components, don't re-render on every playback frame.
  const api: EditorApi = useMemo(
    () => ({
      project,
      seek,
      patch,
      setTrim,
      generateTitle,
      faceCropEditing,
      setFaceCropEditing,
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
      addOverlay,
      updateOverlay,
      deleteOverlay,
      duplicateOverlay,
      reorderOverlay,
      selectedOverlayId,
      setSelectedOverlayId,
      exportState,
      runExport,
      downloadSubtitles
    }),
    [
      project,
      seek,
      patch,
      setTrim,
      generateTitle,
      faceCropEditing,
      setFaceCropEditing,
      fetchingCaptions,
      regenerateCaptions,
      addCaption,
      updateCaption,
      deleteCaption,
      splitCaption,
      mergeCaptionWithNext,
      toggleCaption,
      selectedCaptionId,
      addOverlay,
      updateOverlay,
      deleteOverlay,
      duplicateOverlay,
      reorderOverlay,
      selectedOverlayId,
      exportState,
      runExport,
      downloadSubtitles
    ]
  );

  const renderPanel = () => {
    switch (tab) {
      case "layout":
        return <LayoutPanel api={api} />;
      case "captions":
        return <CaptionsPanel api={api} />;
      case "style":
        return <StylePanel api={api} />;
      case "overlays":
        return <OverlaysPanel api={api} />;
      case "audio":
        return <AudioPanel api={api} />;
      case "export":
        return <ExportPanel api={api} />;
    }
  };

  const binClips = sourceJob?.clips.filter((clip) => clip.file) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={() => flushThen(onClose)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Projects
        </Button>
        <input
          value={project.name}
          onChange={(e) => patch({ name: e.target.value, title: e.target.value })}
          className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-lg font-semibold text-white outline-none hover:border-[var(--border)] focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={() => void generateTitle()}
          disabled={fetchingCaptions}
          title="Generate a title from the captions"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] transition hover:text-white disabled:opacity-40"
        >
          <Sparkles className="h-4 w-4" />
        </button>
        <span className={cn("flex items-center gap-1.5 text-xs", saved ? "text-emerald-300" : "text-[var(--muted-foreground)]")}>
          <span className={cn("h-1.5 w-1.5 rounded-full", saved ? "bg-emerald-300" : "bg-amber-300")} />
          {saved ? "All changes saved" : "Unsaved changes"}
        </span>
        <Button onClick={() => void saveNow()} disabled={saving || saved}>
          <Save className="mr-2 h-4 w-4" /> {saving ? "Saving…" : saved ? "Saved" : "Save"}
        </Button>
      </div>

      <div
        className={cn(
          "grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]",
          binClips.length > 1 && onOpenClip && "2xl:grid-cols-[220px_minmax(0,1fr)_330px]"
        )}
      >
        {/* Left: other clips from the same stream */}
        {binClips.length > 1 && onOpenClip && (
          <div className="hidden min-w-0 2xl:block">
            <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                Clips from this stream
              </p>
              <div className="max-h-[70vh] space-y-1.5 overflow-y-auto pr-1">
                {sourceJob &&
                  binClips.map((clip) => {
                    const index = sourceJob.clips.indexOf(clip);
                    const active = clip.file === project.sourceFile;
                    return (
                      <button
                        key={clip.id}
                        type="button"
                        disabled={active}
                        onClick={() => flushThen(() => onOpenClip(sourceJob, clip, index))}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg border p-2 text-left transition",
                          active
                            ? "border-[var(--accent)] bg-[var(--accent)]/10"
                            : "border-[var(--border)] hover:border-[var(--border-strong)]"
                        )}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-black/40 font-mono text-xs text-white">
                          {index + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium text-white">
                            {clip.hookQuote || `Clip ${index + 1}`}
                          </span>
                          <span className="block text-[11px] text-[var(--muted-foreground)]">
                            {Math.round(clip.end - clip.start)}s{clip.score > 0 ? ` · score ${clip.score}` : ""}
                          </span>
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* Center: preview + transport + timeline */}
        <div className="min-w-0 space-y-3">
          <EditorPreview
            project={project}
            time={time}
            videoSrc={videoSrc}
            onVideoReady={handleVideoReady}
            onTogglePlay={togglePlay}
            selectedOverlayId={selectedOverlayId}
            onSelectOverlay={setSelectedOverlayId}
            onOverlayChange={updateOverlay}
            onReframeChange={handleReframeChange}
            onCaptionStyleChange={(partial) =>
              setProject((p) => ({ ...p, captionStyle: { ...p.captionStyle, ...partial } }))
            }
            faceCropEditing={faceCropEditing}
            onFaceCropEditingChange={setFaceCropEditing}
            onFaceSourceChange={(rect) => patch({ faceSource: rect })}
          />
          <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "Pause preview" : "Play preview"}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-contrast)]"
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <span className="font-mono text-sm text-white">{formatClock(time)}</span>
            <span className="text-sm text-[var(--muted-foreground)]">/ {formatClock(duration)}</span>
            <input
              aria-label="Scrub preview"
              type="range"
              min={0}
              max={duration}
              step={0.01}
              value={time}
              onChange={(e) => scrubTo(Number(e.target.value))}
              className="ml-2 h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-[var(--accent)]"
            />
            <button
              type="button"
              onClick={() => setMuted((value) => !value)}
              aria-label={muted ? "Unmute preview" : "Mute preview"}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              aria-label="Preview volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const next = Number(e.target.value);
                setVolume(next);
                setMuted(next <= 0);
              }}
              className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-white/15 accent-[var(--accent)]"
            />
          </div>
          <EditorTimeline
            project={project}
            time={time}
            duration={duration}
            trimStart={trimStart}
            trimEnd={trimEnd}
            onSeek={scrubTo}
            onSetTrim={setTrim}
            onResetTrim={resetTrim}
            onSplit={splitAtPlayhead}
            selectedCaptionId={selectedCaptionId}
            onSelectCaption={setSelectedCaptionId}
            onCaptionChange={updateCaption}
            selectedOverlayId={selectedOverlayId}
            onSelectOverlay={setSelectedOverlayId}
            onOverlayChange={updateOverlay}
          />
        </div>

        {/* Right: tabbed editing panels */}
        <div className="min-w-0 space-y-3">
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
          <div key={tab} className="panel-enter rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            {renderPanel()}
          </div>
        </div>
      </div>
    </div>
  );
}
