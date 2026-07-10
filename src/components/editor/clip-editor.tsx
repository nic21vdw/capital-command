"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  Layers,
  LayoutTemplate,
  ListMusic,
  Loader2,
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
import { writeDraftProject } from "@/components/editor/drafts";
import { useEditorExports } from "@/components/editor/exports-provider";
import { cn, safeFilename } from "@/lib/utils";
import type { CaptionSegment, ClipProject, CropTarget, Overlay, OverlayKind } from "@/types/domain";
import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";
import type { EditorApi } from "@/components/editor/types";

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
  const { data, mutate } = useAppData();
  const { exportStateFor, startExport } = useEditorExports();
  const router = useRouter();
  const [project, setProject] = useState<ClipProject>(initialProject);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("layout");
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [cropEditing, setCropEditing] = useState<CropTarget>(null);
  const [fetchingCaptions, setFetchingCaptions] = useState(false);
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
  // Poster paints a real frame the instant the editor opens, instead of a
  // black frame while the video data streams in.
  const posterSrc = project.posterFile
    ? `/api/clips/${project.jobId}/files/${encodeURIComponent(project.posterFile)}`
    : undefined;
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
        if (cancelled) return;
        setSourceJob(job);
        // The backend clip title is the shared source of truth across the
        // Generator, Editor and Uploading Center — adopt it if it was renamed
        // elsewhere since this project was last opened.
        setProject((prev) => {
          const clip = job.clips.find((candidate) => candidate.file === prev.sourceFile);
          if (!clip?.title || clip.title === prev.title) return prev;
          return { ...prev, title: clip.title, name: clip.title };
        });
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
      const next = { ...project, updatedAt: new Date().toISOString() };
      // Mirror every save into the local draft so a reload can never resurrect
      // an out-of-date snapshot (and edits survive even if the server save fails).
      writeDraftProject(next);
      void mutate("upsertClipProject", next).then(() => setSaved(true));
    }, 700);
    return () => clearTimeout(timer);
  }, [project, mutate]);

  const patch = useCallback((partial: Partial<ClipProject>) => {
    setProject((prev) => ({ ...prev, ...partial }));
  }, []);

  // Write title edits (typed or generated) through to the backend clip, so
  // the Clip Generator and the Uploading Center show the same name. Debounced
  // like the autosave; comparing against the loaded job prevents loops, and
  // updating sourceJob from the response keeps the comparison current.
  useEffect(() => {
    const clip = sourceJob?.clips.find((candidate) => candidate.file === project.sourceFile);
    const title = project.title.trim();
    if (!clip || !title || title === (clip.title ?? "")) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/clips/${project.jobId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clipId: clip.id, clipTitle: title })
          });
          if (res.ok) setSourceJob(((await res.json()) as { job: ClipJob }).job);
        } catch {
          // Non-fatal — the next title edit retries.
        }
      })();
    }, 700);
    return () => clearTimeout(timer);
  }, [project.title, project.jobId, project.sourceFile, sourceJob]);

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
      const next = { ...project, updatedAt: new Date().toISOString() };
      writeDraftProject(next);
      await mutate("upsertClipProject", next);
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
    const title = generateClipTitle(trimmedCaptions.length ? trimmedCaptions : captions, project.name, project.title);
    patch({ title, name: title, captions });
    toast.success("Generated clip title.");
  }, [project.captions, project.captionStyle.maxWordsPerCaption, project.clipEnd, project.clipStart, project.jobId, project.name, project.title, trimEnd, trimStart, patch]);

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
      text: kind === "text" ? "Text" : undefined,
      src,
      // Watermarks default to a full-width banner across the top of the short:
      // the base image width is 0.4× the frame, so 2.5× scale spans it edge to edge.
      x: 0.5,
      y: kind === "watermark" ? 0.05 : 0.5,
      scale: kind === "watermark" ? 2.5 : 1,
      rotation: 0,
      opacity: 1,
      z: project.overlays.length,
      locked: false,
      start: 0,
      end: duration,
      // Text overlays default to Dracula purple in the caption's Inter-bold
      // style so a fresh overlay matches the burned-in captions out of the box.
      color: "#bd93f9",
      fontFamily: "Inter, system-ui, sans-serif",
      fontWeight: 800,
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

  // Keyboard shortcuts: Space toggles play/pause; Delete/Backspace removes
  // whatever is selected on the timeline — a caption block or a text/image
  // overlay. Ignored while typing in a field so it never eats a keystroke
  // mid-edit.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace" && event.key !== " ") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.key === " ") {
        // Skip when a button has focus — Space should activate it, and a
        // toggle here would fight the click it triggers.
        if (target && target.tagName === "BUTTON") return;
        event.preventDefault(); // keep the page from scrolling
        togglePlay();
        return;
      }
      if (selectedCaptionId) {
        event.preventDefault();
        deleteCaption(selectedCaptionId);
        setSelectedCaptionId(null);
        toast.success("Caption deleted.");
      } else if (selectedOverlayId) {
        event.preventDefault();
        deleteOverlay(selectedOverlayId);
        toast.success("Overlay deleted.");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedCaptionId, selectedOverlayId, deleteCaption, deleteOverlay, togglePlay]);

  // --- Export ---
  const downloadSubtitles = useCallback((format: "srt" | "vtt") => {
    const text = format === "srt" ? serializeSrt(project.captions) : serializeVtt(project.captions);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeFilename(project.name || project.exportSettings.filename)}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [project.captions, project.name, project.exportSettings.filename]);

  // Snapshot of the project as of the last render we started, so Schedule
  // Short knows whether the finished export still matches the current edits.
  const lastExportedRef = useRef<string | null>(null);

  // Kick off the render through the shared provider, which keeps polling it in
  // the background even after this editor unmounts (e.g. you switch clips).
  const runExport = useCallback(() => {
    lastExportedRef.current = JSON.stringify(project);
    void startExport(project);
  }, [project, startExport]);

  // Live progress for this clip, sourced from the background tracker so a render
  // started here still shows its progress when you leave and come back.
  const exportState = exportStateFor(project.id);

  // --- Schedule Short: render the edits, then jump to the Uploading Center
  // with this clip pre-selected so it can be dropped straight onto a slot.
  const [schedulePending, setSchedulePending] = useState(false);
  const goToUploadingCenter = useCallback(() => {
    const params = new URLSearchParams({ scheduleJob: project.jobId, scheduleClip: project.sourceFile });
    router.push(`/uploading-center?${params.toString()}`);
  }, [project.jobId, project.sourceFile, router]);

  const scheduleShort = useCallback(() => {
    const snapshot = JSON.stringify(project);
    // Only skip the render when the last export finished AND nothing changed
    // since — what gets posted must be exactly what's on screen.
    if (exportState.status === "done" && lastExportedRef.current === snapshot) {
      flushThen(goToUploadingCenter);
      return;
    }
    setSchedulePending(true);
    const rendering = exportState.status === "processing" || exportState.status === "starting";
    if (!rendering) {
      lastExportedRef.current = snapshot;
      void startExport(project); // persists the project before rendering
    }
    toast.info("Rendering your Short — you'll land in the Uploading Center when it's ready.");
  }, [exportState.status, flushThen, goToUploadingCenter, project, startExport]);

  useEffect(() => {
    if (!schedulePending) return;
    if (exportState.status !== "done" && exportState.status !== "error") return;
    let cancelled = false;
    // Deferred so the state updates land after the render pass, not inside it.
    queueMicrotask(() => {
      if (cancelled) return;
      setSchedulePending(false);
      if (exportState.status === "done") {
        goToUploadingCenter();
      } else {
        toast.error(exportState.error ?? "The render failed — check the Export tab and try again.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [schedulePending, exportState.status, exportState.error, goToUploadingCenter]);

  // Memoized (and deliberately without the live playhead time) so the panels,
  // which are React.memo components, don't re-render on every playback frame.
  const api: EditorApi = useMemo(
    () => ({
      project,
      seek,
      patch,
      setTrim,
      generateTitle,
      cropEditing,
      setCropEditing,
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
      cropEditing,
      setCropEditing,
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
        <Button onClick={scheduleShort} disabled={schedulePending} title="Render this Short and pick its slot in the Uploading Center">
          {schedulePending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rendering… {exportState.progress}%
            </>
          ) : (
            <>
              <CalendarClock className="mr-2 h-4 w-4" /> Schedule Short
            </>
          )}
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
                    // Surface a background render happening on this other clip so
                    // you can see it's still working while you edit somewhere else.
                    const clipProject = data.clipProjects.find(
                      (p) => p.jobId === project.jobId && p.sourceFile === clip.file
                    );
                    const clipExport = clipProject ? exportStateFor(clipProject.id) : null;
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
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-white">
                            {clip.title || clip.hookQuote || `Clip ${index + 1}`}
                          </span>
                          <span className="block text-[11px] text-[var(--muted-foreground)]">
                            {Math.round(clip.end - clip.start)}s{clip.score > 0 ? ` · score ${clip.score}` : ""}
                          </span>
                        </span>
                        {clipExport && (clipExport.status === "processing" || clipExport.status === "starting") && (
                          <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-[var(--accent)]">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {clipExport.progress}%
                          </span>
                        )}
                        {clipExport?.status === "done" && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                        )}
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
            posterSrc={posterSrc}
            onVideoReady={handleVideoReady}
            onTogglePlay={togglePlay}
            selectedOverlayId={selectedOverlayId}
            onSelectOverlay={setSelectedOverlayId}
            onOverlayChange={updateOverlay}
            onReframeChange={handleReframeChange}
            onCaptionStyleChange={(partial) =>
              setProject((p) => ({ ...p, captionStyle: { ...p.captionStyle, ...partial } }))
            }
            cropEditing={cropEditing}
            onCropEditingChange={setCropEditing}
            onFaceSourceChange={(rect) => patch({ faceSource: rect })}
            onScreenSourceChange={(rect) => patch({ screenSource: rect })}
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
