"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
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
import type { ScheduleSlot } from "@/lib/publisher/slots";

// One open slot offered in the Schedule Short dropdown for one-click scheduling.
type QuickSlot = { utc: string; label: string; today: boolean };
// The schedule grid always shows a two-week window (mirrors the Uploading Center).
const SLOT_WINDOW_DAYS = 14;

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

// Structural equality for the undo history. A serialized compare is plenty fast
// for a single clip project and spares us a hand-written deep-equal that would
// drift as the project shape grows.
function sameProject(a: ClipProject, b: ClipProject): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
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
  const { exportStateFor, startExport, stopExport } = useEditorExports();
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

  // --- Undo / redo ---
  // A single history stack over the whole project so Ctrl+Z reverts the last
  // edit — including a slight pan of the video you didn't mean to make. Edits
  // land as a stream of setProject calls (a pan drag fires dozens), so we don't
  // record every intermediate value: a debounce lets the project settle, then
  // commits one checkpoint. That collapses an entire drag into a single undo.
  const projectRef = useRef(project);
  const lastCommittedRef = useRef<ClipProject>(initialProject);
  const pastRef = useRef<ClipProject[]>([]);
  const futureRef = useRef<ClipProject[]>([]);
  // Set while an undo/redo is applying so the commit effect doesn't re-record
  // the restored state as a brand-new edit.
  const restoringRef = useRef(false);

  useEffect(() => {
    projectRef.current = project;
    if (restoringRef.current) {
      restoringRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      if (sameProject(project, lastCommittedRef.current)) return;
      pastRef.current.push(lastCommittedRef.current);
      // Cap the depth so a long editing session can't grow the stack unbounded.
      if (pastRef.current.length > 100) pastRef.current.shift();
      lastCommittedRef.current = project;
      // A fresh edit invalidates any redo path.
      futureRef.current = [];
    }, 350);
    return () => clearTimeout(timer);
  }, [project]);

  const applyRestore = useCallback((next: ClipProject) => {
    restoringRef.current = true;
    setProject(next);
  }, []);

  const undo = useCallback(() => {
    const current = projectRef.current;
    if (!sameProject(current, lastCommittedRef.current)) {
      // An edit is still settling (e.g. you just nudged the video): jump back to
      // the last committed state without waiting for the debounce to fire.
      futureRef.current.push(current);
      applyRestore(lastCommittedRef.current);
      return;
    }
    const prev = pastRef.current.pop();
    if (!prev) {
      toast("Nothing to undo.");
      return;
    }
    futureRef.current.push(current);
    lastCommittedRef.current = prev;
    applyRestore(prev);
  }, [applyRestore]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(lastCommittedRef.current);
    lastCommittedRef.current = next;
    applyRestore(next);
  }, [applyRestore]);

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
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

      // Ctrl/Cmd+Z undoes the last edit (a misplaced video nudge, a caption
      // tweak, anything). Shift adds redo, as does Ctrl+Y on Windows. Skipped
      // while typing so it defers to the field's own text undo.
      if (!typing && (event.ctrlKey || event.metaKey)) {
        const key = event.key.toLowerCase();
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
          return;
        }
        if (key === "y") {
          event.preventDefault();
          redo();
          return;
        }
      }

      if (event.key !== "Delete" && event.key !== "Backspace" && event.key !== " ") return;
      if (typing) return;
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
  }, [selectedCaptionId, selectedOverlayId, deleteCaption, deleteOverlay, undo, redo, togglePlay]);

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

  const stopExportForClip = useCallback(() => {
    void stopExport(project.id);
  }, [project.id, stopExport]);

  // Live progress for this clip, sourced from the background tracker so a render
  // started here still shows its progress when you leave and come back.
  const exportState = exportStateFor(project.id);

  // --- Schedule Short ---
  // Two ways to place this clip on the calendar, both from one button:
  //  • pick a time from the dropdown → render (if needed) and schedule the
  //    Short to YouTube at that slot right here, no trip to the Uploading Center;
  //  • "Pick a slot in the Uploading Center" → render, then jump there with the
  //    clip pre-selected for manual placement (the original flow).
  // `pending` holds whichever action is waiting on the render to finish.
  const [pending, setPending] = useState<
    | null
    | { type: "navigate" }
    | { type: "slot"; slotUtc: string; label: string }
  >(null);
  const [slotOptions, setSlotOptions] = useState<QuickSlot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [publishEnabled, setPublishEnabled] = useState(true);
  // Keep the control locked until the publish API has accepted the slot. Without
  // this, the menu can reopen during the upload and briefly offer the same time.
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);

  const goToUploadingCenter = useCallback(() => {
    const params = new URLSearchParams({ scheduleJob: project.jobId, scheduleClip: project.sourceFile });
    router.push(`/uploading-center?${params.toString()}`);
  }, [project.jobId, project.sourceFile, router]);

  // Load the next open slots for the dropdown: the schedule grid's future slots
  // minus any already booked in the queue, soonest first. Fetched each time the
  // menu opens so it reflects whatever was scheduled since the editor loaded.
  const loadSlots = useCallback(async () => {
    setSlotsLoading(true);
    try {
      const [overviewRes, queueRes] = await Promise.all([
        fetch(`/api/publish/overview?days=${SLOT_WINDOW_DAYS}&offsetDays=0`, { cache: "no-store" }),
        fetch("/api/publish", { cache: "no-store" })
      ]);
      const overview = overviewRes.ok
        ? ((await overviewRes.json()) as { enabled: boolean; slots: ScheduleSlot[] })
        : null;
      if (!overview?.enabled) {
        setPublishEnabled(false);
        setSlotOptions([]);
        return;
      }
      setPublishEnabled(true);
      const queue = queueRes.ok ? ((await queueRes.json()) as { items?: Array<{ publishAt: string }> }) : {};
      const taken = new Set((queue.items ?? []).map((item) => new Date(item.publishAt).toISOString()));
      const open = overview.slots
        .filter((slot) => !slot.past && !taken.has(slot.utc))
        .slice(0, 8)
        .map((slot) => ({ utc: slot.utc, label: `${slot.dateLabel} · ${slot.time}`, today: slot.today }));
      setSlotOptions(open);
    } catch {
      setSlotOptions([]);
    } finally {
      setSlotsLoading(false);
    }
  }, []);

  // Schedule the freshly rendered export straight to YouTube at `slotUtc`. The
  // publish API uploads it private with a go-live time, so it shows as Scheduled
  // in YouTube Studio and flips live on its own — exactly like the drag-onto-a-
  // slot flow in the Uploading Center.
  const scheduleToSlot = useCallback(
    async (slotUtc: string, file: string, label: string) => {
      setScheduleSubmitting(true);
      try {
        const res = await fetch("/api/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: project.jobId,
            file,
            publishAt: slotUtc,
            title: project.title.trim() || project.name.trim() || undefined,
            platforms: ["youtube"],
            // "public" is what makes YouTube honor publishAt: uploaded private,
            // flipped live at the slot time.
            visibility: "public"
          })
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          report?: { outcomes: Array<{ platform: string; outcome: string; detail: string }> };
        };
        if (!res.ok) {
          toast.error(data.error ?? "Could not schedule the Short.");
          return;
        }

        // The POST has persisted the queue item. Remove the selected time now so
        // it cannot be offered again, then reconcile against the full queue to
        // pull in anything scheduled from another tab while this upload ran.
        setSlotOptions((current) => current?.filter((slot) => slot.utc !== slotUtc) ?? current);
        void loadSlots();

        const outcome = data.report?.outcomes.find((entry) => entry.platform === "youtube");
        if (outcome?.outcome === "scheduled") {
          toast.success(`Scheduled for ${label} — it now shows as Scheduled on YouTube.`);
        } else if (outcome?.outcome === "published") {
          toast.success("Published to YouTube.");
        } else if (outcome?.outcome === "failed" || outcome?.outcome === "retrying") {
          toast.warning(`Scheduled for ${label}, but the upload hit a snag: ${outcome.detail || outcome.outcome}. It will retry.`);
        } else {
          toast.success(`Scheduled for ${label}.`);
        }
      } catch {
        toast.error("Network error while scheduling the Short.");
      } finally {
        setScheduleSubmitting(false);
      }
    },
    [loadSlots, project.jobId, project.name, project.title]
  );

  // Ensure the on-screen edits are rendered, then run `target`. When the last
  // render already matches what's on screen we act immediately; otherwise we
  // kick a render and stash the action in `pending` for the effect below.
  const runSchedule = useCallback(
    (target: { type: "navigate" } | { type: "slot"; slotUtc: string; label: string }) => {
      const snapshot = JSON.stringify(project);
      if (exportState.status === "done" && lastExportedRef.current === snapshot && exportState.file) {
        const file = exportState.file;
        flushThen(() => {
          if (target.type === "navigate") goToUploadingCenter();
          else void scheduleToSlot(target.slotUtc, file, target.label);
        });
        return;
      }
      setPending(target);
      const rendering = exportState.status === "processing" || exportState.status === "starting";
      if (!rendering) {
        lastExportedRef.current = snapshot;
        void startExport(project); // persists the project before rendering
      }
      toast.info(
        target.type === "navigate"
          ? "Rendering your Short — you'll land in the Uploading Center when it's ready."
          : "Rendering your Short — it'll be scheduled automatically when it's ready."
      );
    },
    [exportState.status, exportState.file, flushThen, goToUploadingCenter, project, scheduleToSlot, startExport]
  );

  useEffect(() => {
    if (!pending) return;
    if (exportState.status !== "done" && exportState.status !== "error") return;
    let cancelled = false;
    // Deferred so the state updates land after the render pass, not inside it.
    queueMicrotask(() => {
      if (cancelled) return;
      const target = pending;
      setPending(null);
      if (exportState.status === "error") {
        toast.error(exportState.error ?? "The render failed — check the Export tab and try again.");
        return;
      }
      if (target.type === "navigate") {
        goToUploadingCenter();
      } else if (exportState.file) {
        void scheduleToSlot(target.slotUtc, exportState.file, target.label);
      } else {
        toast.error("The render finished but produced no file. Try again from the Export tab.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pending, exportState.status, exportState.error, exportState.file, goToUploadingCenter, scheduleToSlot]);

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
      stopExport: stopExportForClip,
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
      stopExportForClip,
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
        <ScheduleShortMenu
          pending={pending !== null || scheduleSubmitting}
          progress={exportState.progress}
          slots={slotOptions}
          slotsLoading={slotsLoading}
          publishEnabled={publishEnabled}
          onOpen={loadSlots}
          onPickSlot={(slot) => runSchedule({ type: "slot", slotUtc: slot.utc, label: slot.label })}
          onOpenUploadingCenter={() => runSchedule({ type: "navigate" })}
        />
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

/**
 * The Schedule Short split button. Clicking it opens a dropdown of the next
 * open slots — pick one to render and schedule the Short to YouTube in one shot
 * — plus an escape hatch into the Uploading Center for manual placement. While
 * a render is in flight the whole control shows live progress and is disabled.
 */
function ScheduleShortMenu({
  pending,
  progress,
  slots,
  slotsLoading,
  publishEnabled,
  onOpen,
  onPickSlot,
  onOpenUploadingCenter
}: {
  pending: boolean;
  progress: number;
  slots: QuickSlot[] | null;
  slotsLoading: boolean;
  publishEnabled: boolean;
  onOpen: () => void;
  onPickSlot: (slot: QuickSlot) => void;
  onOpenUploadingCenter: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on an outside click or Escape while the menu is open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) onOpen();
  };

  return (
    <div ref={ref} className="relative">
      <Button
        onClick={toggle}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Render this Short and schedule it — or pick a slot in the Uploading Center"
      >
        {pending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rendering… {progress}%
          </>
        ) : (
          <>
            <CalendarClock className="mr-2 h-4 w-4" /> Schedule Short
            <ChevronDown className={cn("ml-2 h-4 w-4 transition-transform", open && "rotate-180")} />
          </>
        )}
      </Button>
      {open && !pending ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xl"
        >
          {!publishEnabled ? (
            <p className="px-2 py-3 text-xs text-[var(--muted-foreground)]">
              Publishing is switched off. Set <code className="rounded bg-white/10 px-1 py-0.5">PUBLISH_ENABLED=true</code> to
              schedule Shorts directly.
            </p>
          ) : (
            <>
              <p className="px-2 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                Schedule to YouTube
              </p>
              {slotsLoading ? (
                <div className="flex items-center gap-2 px-2 py-3 text-xs text-[var(--muted-foreground)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Finding open slots…
                </div>
              ) : slots && slots.length > 0 ? (
                <div className="max-h-64 space-y-0.5 overflow-y-auto">
                  {slots.map((slot) => (
                    <button
                      key={slot.utc}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpen(false);
                        onPickSlot(slot);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-white transition hover:bg-white/5"
                    >
                      <Clock className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
                      <span className="min-w-0 flex-1 truncate">{slot.label}</span>
                      {slot.today ? (
                        <span className="shrink-0 rounded-full bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                          Today
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="px-2 py-3 text-xs text-[var(--muted-foreground)]">
                  No open slots in the next two weeks — pick a time in the Uploading Center.
                </p>
              )}
            </>
          )}
          <div className="my-1 border-t border-[var(--border)]" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenUploadingCenter();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/10"
          >
            <Upload className="h-3.5 w-3.5" /> Pick a slot in the Uploading Center
          </button>
        </div>
      ) : null}
    </div>
  );
}
