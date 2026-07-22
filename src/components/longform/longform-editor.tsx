"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  AudioLines,
  Captions,
  Check,
  Copy,
  Crosshair,
  Download,
  FileText,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Monitor,
  Music4,
  Pause,
  Play,
  Plus,
  Scissors,
  Send,
  Slice,
  Smartphone,
  Sparkles,
  Square,
  Trash2,
  Upload,
  UploadCloud,
  Volume2,
  VolumeX,
  Zap
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ColorField, Field, NumberField, RangeField, SelectField, Toggle } from "@/components/editor/controls";
import { SfxSection } from "@/components/editor/sfx-section";
import { DescriptionDropdown } from "@/components/editor/description-dropdown";
import { LongformAudioMixer } from "@/components/longform/longform-audio-mixer";
import { LongformPreview } from "@/components/longform/longform-preview";
import { LongformTimeline, type TimelineSelection } from "@/components/longform/longform-timeline";
import { CAPTION_PRESETS } from "@/lib/clipping/captions";
import { applyCaptionPreset, formatClock } from "@/lib/clipping/editor";
import { PACE_PRESETS, applyManualRange, editedDurationSec, hookCaptions, transcriptCaptions, type PacePresetId } from "@/lib/longform/plan";
import type { LongformVideoMetadata } from "@/lib/longform/metadata";
import type { LongformAudioClip, LongformExportRecord, LongformOverlay, LongformProject, MusicTrack } from "@/lib/longform/types";
import type { CaptionAlignment, CaptionAnimation, CaptionPosition, CaptionPresetId, CaptionSegment } from "@/types/domain";
import { cn } from "@/lib/utils";

// The Long-Form Editor working view: preview + timeline on the left, the
// Hook / Captions / Cuts / Music / Export panels on the right. Every change
// autosaves to the server after a short debounce, mirroring the Clip Editor.

const TABS = [
  { id: "hook", label: "Hook", icon: Zap },
  { id: "captions", label: "Captions", icon: Captions },
  { id: "cuts", label: "Cuts", icon: Scissors },
  { id: "trim", label: "Trim", icon: Slice },
  { id: "images", label: "Images", icon: ImageIcon },
  { id: "music", label: "Audio", icon: Music4 },
  { id: "publish", label: "Publish", icon: FileText },
  { id: "export", label: "Export", icon: Upload }
] as const;

/** Default seconds a freshly dropped image stays on screen. */
const OVERLAY_DEFAULT_SEC = 5;

/** Shortest the hook window is ever allowed to be, in seconds. */
const MIN_HOOK_SEC = 1;

type TabId = (typeof TABS)[number]["id"];

/** Hook caption looks tuned for thumb-stopping openings. */
const HOOK_STYLE_PRESETS: Array<{ id: string; label: string; patch: Partial<LongformProject["hook"]["captionStyle"]> }> = [
  { id: "viral-yellow", label: "Viral yellow", patch: { highlightColor: "#ffd34d", fontWeight: 900, uppercase: true, fontScale: 0.075, animation: "pop", position: "middle" } },
  { id: "purple-pop", label: "Purple pop", patch: { highlightColor: "#bd93f9", fontWeight: 900, uppercase: true, fontScale: 0.075, animation: "pop", position: "middle" } },
  { id: "green-flash", label: "Green flash", patch: { highlightColor: "#39e08b", fontWeight: 900, uppercase: true, fontScale: 0.07, animation: "karaoke", position: "middle" } },
  { id: "clean-white", label: "Clean white", patch: { highlightColor: "#ffffff", fontWeight: 800, uppercase: false, fontScale: 0.06, animation: "fade", position: "lower-third" } }
];

type CutRange = { start: number; end: number };

function cutRangesOf(project: LongformProject): CutRange[] {
  const ranges: CutRange[] = [];
  for (const segment of [...project.segments].sort((a, b) => a.start - b.start)) {
    if (segment.enabled) continue;
    const last = ranges[ranges.length - 1];
    if (last && segment.start - last.end < 0.002) last.end = segment.end;
    else ranges.push({ start: segment.start, end: segment.end });
  }
  return ranges;
}

function endOfEdit(project: LongformProject): number {
  let end = project.hook.enabled ? project.hook.end : 0;
  for (const segment of project.segments) {
    if (segment.enabled) end = Math.max(end, segment.end);
  }
  return end || project.durationSec;
}

export function LongformEditor({
  initialProject,
  onClose,
  onDeleted
}: {
  initialProject: LongformProject;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [project, setProject] = useState(initialProject);
  const [tab, setTab] = useState<TabId>("hook");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [editedMode, setEditedMode] = useState(true);
  const [focusEditing, setFocusEditing] = useState(false);
  const [saved, setSaved] = useState(true);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [selection, setSelection] = useState<TimelineSelection | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  // Blob URLs for images uploaded this session, so the preview and timeline
  // show them instantly without a round-trip to the serving route.
  const [overlayUrls, setOverlayUrls] = useState<Record<string, string>>({});
  const overlayUrlsRef = useRef(overlayUrls);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const projectRef = useRef(project);
  const editedModeRef = useRef(editedMode);
  const cutRangesRef = useRef<CutRange[]>(cutRangesOf(initialProject));
  const endRef = useRef(endOfEdit(initialProject));
  const skipDirtyRef = useRef(true);

  useEffect(() => {
    projectRef.current = project;
    cutRangesRef.current = cutRangesOf(project);
    endRef.current = endOfEdit(project);
  }, [project]);
  useEffect(() => {
    editedModeRef.current = editedMode;
  }, [editedMode]);
  useEffect(() => {
    overlayUrlsRef.current = overlayUrls;
  }, [overlayUrls]);

  // Live-preview the video/master gain on the source's own audio. The music
  // and any boost above 100% only exist in the export, so the element volume
  // is clamped to the previewable 0..1 range.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const gain = (project.music.videoVolume ?? 1) * (project.music.masterVolume ?? 1);
    video.volume = Math.min(1, Math.max(0, gain));
  }, [project.music.videoVolume, project.music.masterVolume]);

  // Waveform peaks for the timeline (cached server-side).
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/clips/sources/${initialProject.sourceId}/waveform`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { peaks?: number[] }) => {
        if (!cancelled && Array.isArray(data.peaks)) setPeaks(data.peaks);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [initialProject.sourceId]);

  // Debounced autosave of the editable fields.
  useEffect(() => {
    if (skipDirtyRef.current) {
      skipDirtyRef.current = false;
      return;
    }
    setSaved(false);
    const timer = setTimeout(() => {
      const current = projectRef.current;
      void fetch(`/api/longform/projects/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: current.name,
          description: current.description,
          keywords: current.keywords,
          segments: current.segments,
          hook: current.hook,
          captions: current.captions,
          overlays: current.overlays,
          music: current.music,
          sfx: current.sfx,
          layout: current.layout ?? "wide",
          pace: current.pace
        })
      })
        .then((response) => {
          if (response.ok) setSaved(true);
          else toast.error("Could not save your changes.");
        })
        .catch(() => toast.error("Could not save. Is the dev server still running?"));
    }, 700);
    return () => clearTimeout(timer);
  }, [project]);

  // Playback loop: throttled time updates plus the jump-cut skip — while the
  // edited preview plays, the playhead leaps over every cut segment exactly
  // like the export will. The hook window always plays verbatim.
  useEffect(() => {
    let raf = 0;
    let lastUpdate = 0;
    const tick = (now: number) => {
      const video = videoRef.current;
      if (video) {
        if (!video.paused && editedModeRef.current) {
          const t = video.currentTime;
          const current = projectRef.current;
          const inHook = current.hook.enabled && t >= (current.hook.start ?? 0) && t < current.hook.end;
          if (!inHook) {
            const cut = cutRangesRef.current.find((range) => t >= range.start - 0.02 && t < range.end - 0.03);
            if (cut) video.currentTime = Math.min(current.durationSec, cut.end + 0.01);
          }
          if (t >= endRef.current - 0.05) {
            video.pause();
            setPlaying(false);
          }
        }
        if (now - lastUpdate > 90 || video.paused) {
          lastUpdate = now;
          setTime(video.currentTime);
          setPlaying(!video.paused);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const patch = useCallback((partial: Partial<LongformProject>) => {
    setProject((current) => ({ ...current, ...partial }));
  }, []);

  const seek = useCallback((t: number) => {
    const video = videoRef.current;
    const clamped = Math.min(projectRef.current.durationSec, Math.max(0, t));
    if (video) video.currentTime = clamped;
    setTime(clamped);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime >= endRef.current - 0.05) video.currentTime = 0;
      void video.play().catch(() => {
        video.muted = true;
        setMuted(true);
        void video.play().catch(() => undefined);
      });
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  }, []);

  const toggleSegment = useCallback((id: string) => {
    setProject((current) => ({
      ...current,
      segments: current.segments.map((segment) =>
        segment.id === id ? { ...segment, enabled: !segment.enabled } : segment
      )
    }));
  }, []);

  // Manual trimming: split segments so an arbitrary span flips to kept/cut.
  const applyRange = useCallback((start: number, end: number, enabled: boolean) => {
    setProject((current) => ({
      ...current,
      segments: applyManualRange(current.segments, start, end, enabled)
    }));
  }, []);

  const setHookEnd = useCallback((end: number) => {
    setProject((current) => {
      const start = current.hook.start ?? 0;
      const clamped = Math.max(start + MIN_HOOK_SEC, Math.min(current.durationSec, end));
      return {
        ...current,
        hook: { ...current.hook, end: clamped, captions: hookCaptions(current.transcript, start, clamped) }
      };
    });
  }, []);

  // Slide where the hook is pulled from: a fumbled opening no longer forces the
  // hook to start at 0. Moving the start rebuilds the captions for the new
  // window and nudges the end out if the window would collapse.
  const setHookStart = useCallback((start: number) => {
    setProject((current) => {
      const clampedStart = Math.max(0, Math.min(start, current.durationSec - MIN_HOOK_SEC));
      const end = Math.max(clampedStart + MIN_HOOK_SEC, current.hook.end);
      return {
        ...current,
        hook: { ...current.hook, start: clampedStart, end, captions: hookCaptions(current.transcript, clampedStart, end) }
      };
    });
  }, []);

  // Revoke any session blob URLs when the editor unmounts.
  useEffect(
    () => () => {
      for (const url of Object.values(overlayUrlsRef.current)) URL.revokeObjectURL(url);
    },
    []
  );

  const overlayImageUrl = useCallback(
    (overlay: LongformOverlay) =>
      overlayUrls[overlay.id] ?? `/api/longform/projects/${project.id}/images/${overlay.id}`,
    [overlayUrls, project.id]
  );

  const uploadImage = useCallback(async (file: File, startSec: number) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files can be added to the timeline.");
      return;
    }
    const blobUrl = URL.createObjectURL(file);
    try {
      const current = projectRef.current;
      const response = await fetch(
        `/api/longform/projects/${current.id}/images?name=${encodeURIComponent(file.name)}`,
        { method: "POST", headers: { "Content-Type": file.type }, body: file }
      );
      const data = (await response.json()) as {
        image?: { id: string; fileName: string; storedName: string; mime: string };
        error?: string;
      };
      if (!response.ok || !data.image) {
        URL.revokeObjectURL(blobUrl);
        toast.error(data.error ?? "Could not add that image.");
        return;
      }
      const image = data.image;
      const duration = projectRef.current.durationSec;
      const start = Math.max(0, Math.min(startSec, Math.max(0, duration - 0.5)));
      const end = Math.min(duration, start + OVERLAY_DEFAULT_SEC);
      const overlay: LongformOverlay = {
        id: image.id,
        fileName: image.fileName,
        storedName: image.storedName,
        mime: image.mime,
        start: Math.round(start * 1000) / 1000,
        end: Math.round(end * 1000) / 1000,
        x: 0.5,
        y: 0.5,
        width: 0.4,
        opacity: 1
      };
      setOverlayUrls((prev) => ({ ...prev, [image.id]: blobUrl }));
      setProject((prev) => ({ ...prev, overlays: [...prev.overlays, overlay] }));
      setSelectedOverlayId(image.id);
      toast.success(`Added “${image.fileName}”.`);
    } catch {
      URL.revokeObjectURL(blobUrl);
      toast.error("Could not add that image. Is the dev server still running?");
    }
  }, []);

  const updateOverlay = useCallback((id: string, partial: Partial<LongformOverlay>) => {
    setProject((prev) => ({
      ...prev,
      overlays: prev.overlays.map((overlay) => (overlay.id === id ? { ...overlay, ...partial } : overlay))
    }));
  }, []);

  const removeOverlay = useCallback((id: string) => {
    setProject((prev) => ({ ...prev, overlays: prev.overlays.filter((overlay) => overlay.id !== id) }));
    setSelectedOverlayId((current) => (current === id ? null : current));
    setOverlayUrls((prev) => {
      if (prev[id]) URL.revokeObjectURL(prev[id]);
      const next = { ...prev };
      delete next[id];
      return next;
    });
    void fetch(`/api/longform/projects/${projectRef.current.id}/images/${id}`, { method: "DELETE" }).catch(
      () => undefined
    );
  }, []);

  // --- Timeline audio clips -------------------------------------------------
  const patchSfx = useCallback((sfx: NonNullable<LongformProject["sfx"]>) => {
    setProject((prev) => ({ ...prev, sfx }));
  }, []);

  const patchMusic = useCallback((partial: Partial<LongformProject["music"]>) => {
    setProject((prev) => ({ ...prev, music: { ...prev.music, ...partial } }));
  }, []);

  // Place a library track onto the audio track as a clip starting at `startSec`.
  const addAudioClip = useCallback((track: MusicTrack, startSec: number) => {
    const id = crypto.randomUUID().slice(0, 8);
    const trackDuration = track.durationSec > 0.2 ? Math.round(track.durationSec * 1000) / 1000 : 15;
    setProject((prev) => {
      const maxStart = Math.max(0, prev.durationSec - 0.5);
      const start = Math.max(0, Math.min(startSec, maxStart));
      const duration = Math.min(trackDuration, Math.max(0.5, prev.durationSec - start));
      const clip: LongformAudioClip = {
        id,
        trackId: track.id,
        fileName: track.fileName,
        start: Math.round(start * 1000) / 1000,
        duration: Math.round(duration * 1000) / 1000,
        volume: 0.5
      };
      return { ...prev, music: { ...prev.music, enabled: true, clips: [...(prev.music.clips ?? []), clip] } };
    });
    setSelectedAudioId(id);
  }, []);

  const updateAudioClip = useCallback((id: string, partial: Partial<LongformAudioClip>) => {
    setProject((prev) => ({
      ...prev,
      music: { ...prev.music, clips: (prev.music.clips ?? []).map((clip) => (clip.id === id ? { ...clip, ...partial } : clip)) }
    }));
  }, []);

  const removeAudioClip = useCallback((id: string) => {
    setProject((prev) => ({
      ...prev,
      music: { ...prev.music, clips: (prev.music.clips ?? []).filter((clip) => clip.id !== id) }
    }));
    setSelectedAudioId((current) => (current === id ? null : current));
  }, []);

  // Copy a clip, dropping the duplicate right after the original so repeats
  // chain end-to-end (handy for looping a short sting across a section).
  const duplicateAudioClip = useCallback((id: string) => {
    const newId = crypto.randomUUID().slice(0, 8);
    setProject((prev) => {
      const clips = prev.music.clips ?? [];
      const clip = clips.find((item) => item.id === id);
      if (!clip) return prev;
      const start = Math.max(0, Math.min(prev.durationSec - 0.2, clip.start + clip.duration));
      const copy: LongformAudioClip = { ...clip, id: newId, start: Math.round(start * 1000) / 1000 };
      return { ...prev, music: { ...prev.music, clips: [...clips, copy] } };
    });
    setSelectedAudioId(newId);
  }, []);

  // Uploading dropped audio/video, then placing it as a clip at the drop point.
  const uploadAndPlaceAudio = useCallback(
    async (file: File, startSec: number) => {
      if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
        toast.error("Drop an audio or video file onto the audio track.");
        return;
      }
      const toastId = toast.loading(file.type.startsWith("video/") ? "Extracting audio…" : "Adding audio…");
      try {
        const response = await fetch(`/api/longform/music?name=${encodeURIComponent(file.name)}`, {
          method: "POST",
          headers: { "Content-Type": file.type || "audio/mpeg" },
          body: file
        });
        const data = (await response.json()) as { track?: MusicTrack; error?: string };
        if (!response.ok || !data.track) {
          toast.error(data.error ?? "Could not add that audio.", { id: toastId });
          return;
        }
        addAudioClip(data.track, startSec);
        toast.success(`Placed “${data.track.fileName}” on the audio track.`, { id: toastId });
      } catch {
        toast.error("Could not add that audio. Is the dev server still running?", { id: toastId });
      }
    },
    [addAudioClip]
  );

  // Keyboard shortcuts: Space toggles play/pause; Delete/Backspace removes
  // what's selected on the timeline: an active trim selection is cut out of
  // the video, otherwise the selected image overlay is removed. Ignored while
  // typing in a field.
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
      if (selection && selection.end - selection.start >= 0.05) {
        event.preventDefault();
        applyRange(selection.start, selection.end, false);
        toast.success(`Trimmed ${formatClock(selection.start)}–${formatClock(selection.end)} out of the video.`);
        setSelection(null);
      } else if (selectedOverlayId) {
        event.preventDefault();
        removeOverlay(selectedOverlayId);
        toast.success("Image removed.");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection, selectedOverlayId, applyRange, removeOverlay, togglePlay]);

  const inCut = useMemo(
    () => cutRangesOf(project).some((range) => time >= range.start && time < range.end),
    [project, time]
  );

  const editedSec = editedDurationSec(project.segments, project.hook);
  const cutSec = Math.max(0, project.durationSec - editedSec);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <Button variant="ghost" onClick={onClose} className="gap-2 px-2">
          <ArrowLeft className="h-4 w-4" /> Projects
        </Button>
        <input
          value={project.name}
          onChange={(event) => patch({ name: event.target.value })}
          className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-sm font-semibold text-white outline-none transition focus:border-[var(--border-strong)]"
          aria-label="Project name"
        />
        {/* Layout: the export's output frame. The 9:16 option centers the edit
            over a blurred fill of itself, ready to post as a short. */}
        <div
          className="flex shrink-0 overflow-hidden rounded-lg border border-[var(--border)]"
          role="group"
          aria-label="Frame layout"
        >
          {(
            [
              { id: "wide", label: "16:9", icon: Monitor, title: "Wide 16:9 — the classic long-form frame" },
              { id: "vertical", label: "9:16", icon: Smartphone, title: "Vertical 9:16 — centered over a blurred fill, ready for shorts" }
            ] as const
          ).map((option) => {
            const Icon = option.icon;
            const active = (project.layout ?? "wide") === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => patch({ layout: option.id })}
                title={option.title}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition",
                  active ? "bg-[var(--accent)]/15 text-white" : "text-[var(--muted-foreground)] hover:text-white"
                )}
              >
                <Icon className={cn("h-3.5 w-3.5", active && "text-[var(--accent)]")} />
                {option.label}
              </button>
            );
          })}
        </div>
        <span
          className={cn("h-2 w-2 shrink-0 rounded-full", saved ? "bg-emerald-400" : "bg-amber-400 animate-pulse")}
          title={saved ? "All changes saved" : "Saving…"}
        />
        <span className="text-xs text-[var(--muted-foreground)]">
          {formatClock(project.durationSec)} → <span className="font-semibold text-white">{formatClock(editedSec)}</span>
          <span className="ml-1 text-emerald-400">(−{formatClock(cutSec)})</span>
        </span>
      </div>

      <DescriptionDropdown
        description={project.description}
        keywords={project.keywords}
        onChange={patch}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Preview + transport + timeline */}
        <div className="min-w-0 space-y-3">
          <LongformPreview
            project={project}
            time={time}
            playing={playing}
            inCut={inCut}
            videoRef={videoRef}
            onTogglePlay={togglePlay}
            focusEditing={focusEditing && tab === "hook"}
            onFocusChange={(x, y) => patch({ hook: { ...project.hook, focusX: x, focusY: y } })}
            onCaptionStyleChange={(partial) =>
              patch({ hook: { ...project.hook, captionStyle: { ...project.hook.captionStyle, ...partial } } })
            }
            onBodyCaptionStyleChange={(partial) =>
              patch({ captions: { ...project.captions, style: { ...project.captions.style, ...partial } } })
            }
            imageUrl={overlayImageUrl}
          />

          {/* Play the placed timeline audio clips live under the preview,
              mirroring what the export mixes in. Silent unless the master
              "Mix audio into the export" switch is on. */}
          <LongformAudioMixer
            clips={project.music.enabled ? project.music.clips ?? [] : []}
            masterVolume={project.music.masterVolume ?? 1}
            muted={muted}
            videoRef={videoRef}
          />

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-contrast)] transition hover:bg-[var(--accent-strong)]"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
            </button>
            <span className="w-28 text-xs tabular-nums text-[var(--muted-foreground)]">
              {formatClock(time)} / {formatClock(project.durationSec)}
            </span>
            <input
              type="range"
              min={0}
              max={project.durationSec}
              step={0.05}
              value={Math.min(time, project.durationSec)}
              onChange={(event) => seek(Number(event.target.value))}
              className="h-1.5 min-w-24 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-[var(--accent)]"
              aria-label="Seek"
            />
            <button
              type="button"
              onClick={() => {
                const video = videoRef.current;
                if (video) video.muted = !muted;
                setMuted(!muted);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] transition hover:text-white"
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setEditedMode(!editedMode)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                editedMode
                  ? "border-[var(--accent)]/60 bg-[var(--accent)]/10 text-white"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
              )}
              title="When on, playback skips the cuts exactly like the export will"
            >
              {editedMode ? "Previewing edit" : "Previewing original"}
            </button>
          </div>

          <LongformTimeline
            project={project}
            time={time}
            peaks={peaks}
            selection={tab === "trim" ? selection : null}
            onSeek={seek}
            onToggleSegment={toggleSegment}
            onHookStartChange={setHookStart}
            onHookEndChange={setHookEnd}
            onSelectionChange={setSelection}
            imageUrl={overlayImageUrl}
            selectedOverlayId={selectedOverlayId}
            onSelectOverlay={(id) => {
              setSelectedOverlayId(id);
              if (id) setTab("images");
            }}
            onOverlayChange={updateOverlay}
            onDropImage={(file, timeSec) => {
              setTab("images");
              void uploadImage(file, timeSec);
            }}
            selectedAudioId={selectedAudioId}
            onSelectAudio={(id) => {
              setSelectedAudioId(id);
              if (id) setTab("music");
            }}
            onAudioChange={updateAudioClip}
            onDropAudio={(file, timeSec) => {
              setTab("music");
              void uploadAndPlaceAudio(file, timeSec);
            }}
          />
        </div>

        {/* Panels */}
        <div className="min-w-0">
          <div className="mb-3 grid grid-cols-7 gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
            {TABS.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[11px] font-medium transition",
                    active ? "bg-[var(--accent)]/15 text-white" : "text-[var(--muted-foreground)] hover:text-white"
                  )}
                >
                  <Icon className={cn("h-4 w-4", active && "text-[var(--accent)]")} />
                  {item.label}
                </button>
              );
            })}
          </div>
          <div key={tab} className="panel-enter space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            {tab === "hook" && (
              <HookPanel
                project={project}
                patch={patch}
                setHookStart={setHookStart}
                setHookEnd={setHookEnd}
                focusEditing={focusEditing}
                setFocusEditing={setFocusEditing}
                seek={seek}
              />
            )}
            {tab === "captions" && <CaptionsPanel project={project} patch={patch} time={time} seek={seek} />}
            {tab === "cuts" && <CutsPanel project={project} patch={patch} setProject={setProject} seek={seek} skipDirtyRef={skipDirtyRef} />}
            {tab === "trim" && (
              <TrimPanel
                project={project}
                time={time}
                selection={selection}
                setSelection={setSelection}
                applyRange={applyRange}
                seek={seek}
              />
            )}
            {tab === "images" && (
              <ImagesPanel
                project={project}
                time={time}
                imageUrl={overlayImageUrl}
                selectedOverlayId={selectedOverlayId}
                setSelectedOverlayId={setSelectedOverlayId}
                uploadImage={uploadImage}
                updateOverlay={updateOverlay}
                removeOverlay={removeOverlay}
                seek={seek}
              />
            )}
            {tab === "music" && (
              <MusicPanel
                project={project}
                time={time}
                selectedAudioId={selectedAudioId}
                setSelectedAudioId={setSelectedAudioId}
                patchMusic={patchMusic}
                patchSfx={patchSfx}
                addAudioClip={addAudioClip}
                updateAudioClip={updateAudioClip}
                removeAudioClip={removeAudioClip}
                duplicateAudioClip={duplicateAudioClip}
                seek={seek}
              />
            )}
            {tab === "publish" && <PublishPanel project={project} setProject={setProject} skipDirtyRef={skipDirtyRef} />}
            {tab === "export" && <ExportPanel project={project} setProject={setProject} skipDirtyRef={skipDirtyRef} onDeleted={onDeleted} editedSec={editedSec} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function HookPanel({
  project,
  patch,
  setHookStart,
  setHookEnd,
  focusEditing,
  setFocusEditing,
  seek
}: {
  project: LongformProject;
  patch: (partial: Partial<LongformProject>) => void;
  setHookStart: (start: number) => void;
  setHookEnd: (end: number) => void;
  focusEditing: boolean;
  setFocusEditing: (v: boolean) => void;
  seek: (t: number) => void;
}) {
  const hook = project.hook;
  const hookStart = hook.start ?? 0;
  const patchHook = (partial: Partial<LongformProject["hook"]>) => patch({ hook: { ...hook, ...partial } });
  const patchStyle = (partial: Partial<LongformProject["hook"]["captionStyle"]>) =>
    patchHook({ captionStyle: { ...hook.captionStyle, ...partial } });
  const updateCaption = (id: string, partial: Partial<CaptionSegment>) =>
    patchHook({ captions: hook.captions.map((seg) => (seg.id === id ? { ...seg, ...partial } : seg)) });
  const deleteCaption = (id: string) => patchHook({ captions: hook.captions.filter((seg) => seg.id !== id) });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Viral hook</h3>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          The first seconds decide whether viewers stay. Punch in on your face and burn in big word-synced captions.
          Fumbled the opening? Move &ldquo;Hook starts at&rdquo; to pull the hook from a stronger moment later in the take.
        </p>
      </div>
      <Toggle label="Hook enabled" checked={hook.enabled} onChange={(v) => patchHook({ enabled: v })} />
      {hook.enabled && (
        <>
          <RangeField
            label="Hook starts at"
            value={hookStart}
            min={0}
            max={Math.max(0, project.durationSec - MIN_HOOK_SEC)}
            step={0.1}
            onChange={(v) => {
              setHookStart(v);
              seek(v);
            }}
            format={(v) => `${v.toFixed(1)}s`}
          />
          <RangeField
            label="Hook length"
            value={Math.max(MIN_HOOK_SEC, hook.end - hookStart)}
            min={3}
            max={Math.min(15, Math.max(4, project.durationSec - hookStart))}
            step={0.1}
            onChange={(len) => setHookEnd(hookStart + len)}
            format={(v) => `${v.toFixed(1)}s`}
          />
          <RangeField
            label="Punch-in zoom"
            value={hook.zoom}
            min={1}
            max={1.8}
            step={0.01}
            onChange={(v) => patchHook({ zoom: v })}
            format={(v) => `${v.toFixed(2)}x`}
          />
          <button
            type="button"
            onClick={() => {
              setFocusEditing(!focusEditing);
              if (!focusEditing) seek(hookStart + Math.min(1, (hook.end - hookStart) / 2));
            }}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
              focusEditing
                ? "border-[var(--accent)] bg-[var(--accent)]/10 text-white"
                : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
            )}
          >
            <Crosshair className="h-4 w-4" />
            {focusEditing ? "Click your face on the preview, then click here" : "Set zoom focus on the preview"}
          </button>

          <div className="border-t border-[var(--border)] pt-4">
            <Toggle label="Hook captions" checked={hook.captionsEnabled} onChange={(v) => patchHook({ captionsEnabled: v })} />
          </div>
          {hook.captionsEnabled && (
            <>
              <Field label="Caption look">
                <div className="flex flex-wrap gap-1.5">
                  {HOOK_STYLE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => patchStyle(preset.patch)}
                      className={cn(
                        "rounded-lg border px-2.5 py-1.5 text-xs transition",
                        hook.captionStyle.highlightColor.toLowerCase() === (preset.patch.highlightColor ?? "").toLowerCase()
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-white"
                          : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </Field>
              <Toggle
                label="Highlight the spoken word"
                checked={hook.highlightCurrentWord}
                onChange={(v) => patchHook({ highlightCurrentWord: v })}
              />
              <RangeField
                label="Caption size"
                value={hook.captionStyle.fontScale}
                min={0.04}
                max={0.12}
                step={0.002}
                onChange={(v) => patchStyle({ fontScale: v })}
                format={(v) => `${Math.round(v * 1000) / 10}%`}
              />
              <ColorField label="Highlight color" value={hook.captionStyle.highlightColor} onChange={(v) => patchStyle({ highlightColor: v })} />
              <SelectField<CaptionPosition>
                label="Position"
                value={hook.captionStyle.position}
                options={[
                  { value: "middle", label: "Center (viral)" },
                  { value: "lower-third", label: "Lower third" },
                  { value: "bottom", label: "Bottom" },
                  { value: "top", label: "Top" }
                ]}
                onChange={(v) => patchStyle({ position: v, offsetX: undefined, offsetY: undefined })}
              />
              <SelectField<CaptionAnimation>
                label="Animation"
                value={hook.captionStyle.animation}
                options={[
                  { value: "pop", label: "Pop" },
                  { value: "karaoke", label: "Karaoke" },
                  { value: "fade", label: "Fade" },
                  { value: "none", label: "None" }
                ]}
                onChange={(v) => patchStyle({ animation: v })}
              />
              <Toggle label="UPPERCASE" checked={hook.captionStyle.uppercase} onChange={(v) => patchStyle({ uppercase: v })} />

              <Field label="Hook caption text" hint="synced to your words">
                <div className="space-y-2">
                  {hook.captions.length === 0 && (
                    <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-xs text-[var(--muted-foreground)]">
                      {project.transcript.length === 0
                        ? "No transcript was generated for this video, so hook captions are unavailable."
                        : "No speech was detected inside the hook window."}
                    </p>
                  )}
                  {hook.captions.map((seg) => (
                    <div key={seg.id} className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          updateCaption(seg.id, { enabled: !seg.enabled });
                        }}
                        className={cn(
                          "mt-1 h-4 w-4 shrink-0 rounded border transition",
                          seg.enabled ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--border)]"
                        )}
                        aria-label={seg.enabled ? "Hide caption" : "Show caption"}
                      />
                      <textarea
                        value={seg.text}
                        onChange={(event) => updateCaption(seg.id, { text: event.target.value })}
                        onFocus={() => seek(hookStart + seg.start + 0.01)}
                        rows={1}
                        className="min-h-9 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-sm text-white outline-none focus:border-[var(--accent)]"
                      />
                      <button
                        type="button"
                        onClick={() => deleteCaption(seg.id)}
                        className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition hover:border-red-400/60 hover:text-red-400"
                        aria-label="Delete caption"
                        title="Delete this hook caption"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </Field>
            </>
          )}
        </>
      )}
    </div>
  );
}

// The editable caption list is windowed around the playhead so a long
// transcript (hundreds of segments) never renders hundreds of textareas.
const CAPTION_LIST_BEHIND_SEC = 20;
const CAPTION_LIST_AHEAD_SEC = 90;

function CaptionsPanel({
  project,
  patch,
  time,
  seek
}: {
  project: LongformProject;
  patch: (partial: Partial<LongformProject>) => void;
  time: number;
  seek: (t: number) => void;
}) {
  const captions = project.captions;
  const s = captions.style;
  const patchCaptions = (partial: Partial<LongformProject["captions"]>) =>
    patch({ captions: { ...captions, ...partial } });
  const patchStyle = (partial: Partial<LongformProject["captions"]["style"]>) =>
    patchCaptions({ style: { ...s, ...partial } });
  const updateSegment = (id: string, partial: Partial<CaptionSegment>) =>
    patchCaptions({ segments: captions.segments.map((seg) => (seg.id === id ? { ...seg, ...partial } : seg)) });
  const deleteSegment = (id: string) => patchCaptions({ segments: captions.segments.filter((seg) => seg.id !== id) });

  // Rebuild the segments from the transcript with the current phrase length.
  // Like changing the hook length, this discards manual text edits.
  const resplit = () => {
    patchCaptions({ segments: transcriptCaptions(project.transcript, s.maxWordsPerCaption) });
    toast.success("Captions re-split from the transcript.");
  };

  const hookCovers = project.hook.enabled && project.hook.captionsEnabled;
  const visible = captions.segments.filter(
    (seg) => seg.end >= time - CAPTION_LIST_BEHIND_SEC && seg.start <= time + CAPTION_LIST_AHEAD_SEC
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Captions</h3>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Burn word-synced captions over the whole video — the same captions the short clips get. They follow your cuts,
          so nothing shows over trimmed footage.
        </p>
      </div>

      <Toggle label="Captions on the whole video" checked={captions.enabled} onChange={(v) => patchCaptions({ enabled: v })} />

      {captions.enabled && captions.segments.length === 0 && (
        <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-xs text-[var(--muted-foreground)]">
          {project.transcript.length === 0
            ? "No transcript was generated for this video, so captions are unavailable."
            : "No speech was detected in this video."}
        </p>
      )}

      {captions.enabled && captions.segments.length > 0 && (
        <>
          {hookCovers && (
            <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
              The hook burns its own captions over its {(project.hook.end - (project.hook.start ?? 0)).toFixed(1)}s window —
              these take over for the rest of the video.
            </p>
          )}

          <Field label="Presets">
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(CAPTION_PRESETS) as CaptionPresetId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => patchCaptions({ style: applyCaptionPreset(s, id) })}
                  className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-foreground)] transition hover:border-[var(--accent)] hover:text-white"
                >
                  {CAPTION_PRESETS[id].label}
                </button>
              ))}
            </div>
          </Field>

          <Toggle
            label="Highlight the spoken word"
            checked={captions.highlightCurrentWord}
            onChange={(v) => patchCaptions({ highlightCurrentWord: v })}
          />

          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Font"
              value={s.fontFamily}
              onChange={(v) => patchStyle({ fontFamily: v })}
              options={[
                { value: "Inter, system-ui, sans-serif", label: "Inter" },
                { value: "Arial, sans-serif", label: "Arial" },
                { value: "Georgia, serif", label: "Georgia" },
                { value: "'Courier New', monospace", label: "Mono" },
                { value: "Impact, sans-serif", label: "Impact" }
              ]}
            />
            <SelectField
              label="Weight"
              value={String(s.fontWeight)}
              onChange={(v) => patchStyle({ fontWeight: Number(v) })}
              options={[
                { value: "400", label: "Regular" },
                { value: "600", label: "Semibold" },
                { value: "800", label: "Bold" },
                { value: "900", label: "Black" }
              ]}
            />
          </div>

          <RangeField
            label="Caption size"
            value={s.fontScale}
            min={0.03}
            max={0.12}
            step={0.002}
            onChange={(v) => patchStyle({ fontScale: v })}
            format={(v) => `${Math.round(v * 1000) / 10}%`}
          />

          <div className="grid grid-cols-2 gap-3">
            <ColorField label="Text colour" value={s.textColor} onChange={(v) => patchStyle({ textColor: v })} />
            <ColorField label="Highlight colour" value={s.highlightColor} onChange={(v) => patchStyle({ highlightColor: v })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ColorField label="Background" value={s.backgroundColor} onChange={(v) => patchStyle({ backgroundColor: v })} />
            <RangeField
              label="Background opacity"
              value={s.backgroundOpacity}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => patchStyle({ backgroundOpacity: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <RangeField label="Outline" value={s.outlineWidth} min={0} max={8} step={0.5} onChange={(v) => patchStyle({ outlineWidth: v })} />
            <RangeField label="Shadow" value={s.shadow} min={0} max={8} step={0.5} onChange={(v) => patchStyle({ shadow: v })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SelectField<CaptionPosition>
              label="Position"
              value={s.position}
              // Picking a preset slot discards any drag-placed position.
              onChange={(v) => patchStyle({ position: v, offsetX: undefined, offsetY: undefined })}
              options={[
                { value: "bottom", label: "Bottom" },
                { value: "lower-third", label: "Lower third" },
                { value: "middle", label: "Middle" },
                { value: "top", label: "Top" }
              ]}
            />
            <SelectField<CaptionAlignment>
              label="Alignment"
              value={s.alignment}
              onChange={(v) => patchStyle({ alignment: v })}
              options={[
                { value: "left", label: "Left" },
                { value: "center", label: "Center" },
                { value: "right", label: "Right" }
              ]}
            />
          </div>
          {s.offsetX !== undefined && s.offsetY !== undefined && (
            <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs">
              <span className="text-[var(--muted-foreground)]">
                Custom placement ({Math.round(s.offsetX * 100)}%, {Math.round(s.offsetY * 100)}%) — drag the caption on
                the preview to adjust.
              </span>
              <button
                type="button"
                className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 font-medium hover:bg-white/5"
                onClick={() => patchStyle({ offsetX: undefined, offsetY: undefined })}
              >
                Reset
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <SelectField<CaptionAnimation>
              label="Animation"
              value={s.animation}
              onChange={(v) => patchStyle({ animation: v })}
              options={[
                { value: "none", label: "None" },
                { value: "fade", label: "Fade" },
                { value: "pop", label: "Pop" },
                { value: "karaoke", label: "Karaoke" }
              ]}
            />
            <div className="flex items-end">
              <Toggle label="UPPERCASE" checked={s.uppercase} onChange={(v) => patchStyle({ uppercase: v })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Max words / caption"
              value={s.maxWordsPerCaption}
              min={1}
              max={20}
              onChange={(v) => patchStyle({ maxWordsPerCaption: v })}
            />
            <NumberField label="Words / line" value={s.wordsPerLine} min={1} max={12} onChange={(v) => patchStyle({ wordsPerLine: v })} />
          </div>
          <Button variant="secondary" className="w-full px-2 text-xs" onClick={resplit}>
            Re-split captions from the transcript
          </Button>

          <Field
            label="Caption text"
            hint={`${visible.length} of ${captions.segments.length} around the playhead`}
          >
            <div className="max-h-[38vh] space-y-2 overflow-y-auto pr-1">
              {visible.length === 0 && (
                <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-xs text-[var(--muted-foreground)]">
                  No captions near the playhead — seek the video to edit other parts.
                </p>
              )}
              {visible.map((seg) => (
                <div key={seg.id} className="rounded-lg border border-[var(--border)] p-2">
                  <div className="mb-1.5 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateSegment(seg.id, { enabled: !seg.enabled })}
                      className={cn(
                        "h-4 w-4 shrink-0 rounded border transition",
                        seg.enabled ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--border)]"
                      )}
                      aria-label={seg.enabled ? "Hide caption" : "Show caption"}
                    />
                    <button
                      type="button"
                      onClick={() => seek(seg.start + 0.01)}
                      className="font-mono text-[11px] text-[var(--accent)] hover:underline"
                    >
                      {formatClock(seg.start)} → {formatClock(seg.end)}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSegment(seg.id)}
                      className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition hover:border-red-400/60 hover:text-red-400"
                      aria-label="Delete caption"
                      title="Delete this caption"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <textarea
                    value={seg.text}
                    onChange={(event) => updateSegment(seg.id, { text: event.target.value })}
                    rows={1}
                    className="min-h-9 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-sm text-white outline-none focus:border-[var(--accent)]"
                  />
                </div>
              ))}
            </div>
          </Field>
        </>
      )}
    </div>
  );
}

function CutsPanel({
  project,
  patch,
  setProject,
  seek,
  skipDirtyRef
}: {
  project: LongformProject;
  patch: (partial: Partial<LongformProject>) => void;
  setProject: React.Dispatch<React.SetStateAction<LongformProject>>;
  seek: (t: number) => void;
  skipDirtyRef: React.MutableRefObject<boolean>;
}) {
  const [replanning, setReplanning] = useState<PacePresetId | null>(null);
  const silenceSegments = project.segments.filter((segment) => segment.kind === "silence");
  const biggest = [...silenceSegments].sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, 12);
  const activePace = PACE_PRESETS.find(
    (preset) =>
      Math.abs(preset.pace.minSilenceSec - project.pace.minSilenceSec) < 0.001 &&
      Math.abs(preset.pace.paddingSec - project.pace.paddingSec) < 0.001
  );

  const applyPace = async (presetId: PacePresetId) => {
    const preset = PACE_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    setReplanning(presetId);
    try {
      const response = await fetch(`/api/longform/projects/${project.id}/replan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preset.pace)
      });
      const data = (await response.json()) as { project?: LongformProject; error?: string };
      if (!response.ok || !data.project) {
        toast.error(data.error ?? "Could not re-plan the cuts.");
        return;
      }
      // The server already saved this state; don't re-trigger autosave.
      skipDirtyRef.current = true;
      setProject(data.project);
      toast.success(`Cuts re-planned at ${preset.label} pace.`);
    } catch {
      toast.error("Could not re-plan the cuts.");
    } finally {
      setReplanning(null);
    }
  };

  const setAll = (enabled: boolean) =>
    patch({
      segments: project.segments.map((segment) => (segment.kind === "silence" ? { ...segment, enabled } : segment))
    });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Auto cuts</h3>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Every pause with no talking is trimmed so the video stays fast-paced. Tune how aggressive it is, then fix
          anything by clicking blocks on the timeline.
        </p>
      </div>

      <Field label="Pace" hint="re-plans from the detected silences">
        <div className="space-y-1.5">
          {PACE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={replanning !== null}
              onClick={() => void applyPace(preset.id)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition disabled:opacity-60",
                activePace?.id === preset.id
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-white"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
              )}
            >
              <span>
                <span className="block font-medium">{preset.label}</span>
                <span className="block text-xs opacity-80">{preset.description}</span>
              </span>
              {replanning === preset.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
            </button>
          ))}
        </div>
      </Field>

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1 px-2 text-xs" onClick={() => setAll(false)}>
          Cut all dead space
        </Button>
        <Button variant="secondary" className="flex-1 px-2 text-xs" onClick={() => setAll(true)}>
          Restore everything
        </Button>
      </div>

      <Field label="Biggest pauses" hint={`${silenceSegments.length} detected`}>
        <div className="space-y-1.5">
          {biggest.length === 0 && (
            <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-xs text-[var(--muted-foreground)]">
              No dead space found — this recording is already tight.
            </p>
          )}
          {biggest.map((segment) => (
            <div
              key={segment.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs"
            >
              <button
                type="button"
                onClick={() => seek(Math.max(0, segment.start - 1))}
                className="flex-1 text-left text-[var(--muted-foreground)] transition hover:text-white"
                title="Jump to this pause"
              >
                {formatClock(segment.start)} · {(segment.end - segment.start).toFixed(1)}s pause
              </button>
              <KeepToggle
                kept={segment.enabled}
                onChange={(keep) =>
                  patch({
                    segments: project.segments.map((item) =>
                      item.id === segment.id ? { ...item, enabled: keep } : item
                    )
                  })
                }
              />
            </div>
          ))}
        </div>
      </Field>
    </div>
  );
}

/**
 * A plain keep/cut switch. The colour and label always read the current state
 * (green "Keep" vs red "Cut"), so there's no guessing what the control does —
 * flipping it keeps or removes that stretch of footage.
 */
function KeepToggle({ kept, onChange }: { kept: boolean; onChange: (keep: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={kept}
      onClick={() => onChange(!kept)}
      title={kept ? "Kept in the video — flip to cut it out" : "Cut from the video — flip to keep it"}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors duration-200",
        kept ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300" : "border-red-400/50 bg-red-400/10 text-red-300"
      )}
    >
      <span
        className={cn(
          "relative h-4 w-7 shrink-0 rounded-full transition-colors duration-200",
          kept ? "bg-emerald-400" : "bg-red-400/70"
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out",
            kept && "translate-x-3"
          )}
        />
      </span>
      {kept ? "Keep" : "Cut"}
    </button>
  );
}

function TrimPanel({
  project,
  time,
  selection,
  setSelection,
  applyRange,
  seek
}: {
  project: LongformProject;
  time: number;
  selection: TimelineSelection | null;
  setSelection: React.Dispatch<React.SetStateAction<TimelineSelection | null>>;
  applyRange: (start: number, end: number, enabled: boolean) => void;
  seek: (t: number) => void;
}) {
  const hasSelection = !!selection && selection.end - selection.start >= 0.05;
  const manualCuts = project.segments
    .filter((segment) => segment.kind === "speech" && !segment.enabled)
    .sort((a, b) => a.start - b.start);
  const inHook =
    project.hook.enabled &&
    !!selection &&
    selection.end > (project.hook.start ?? 0) &&
    selection.start < project.hook.end;

  const setStartHere = () =>
    setSelection((prev) => {
      const start = Math.min(time, project.durationSec - 0.05);
      const end = prev && prev.end > start + 0.05 ? prev.end : Math.min(project.durationSec, start + 2);
      return { start: Math.max(0, start), end };
    });

  const setEndHere = () =>
    setSelection((prev) => {
      const end = Math.max(time, 0.05);
      const start = prev && prev.start < end - 0.05 ? prev.start : Math.max(0, end - 2);
      return { start, end: Math.min(project.durationSec, end) };
    });

  const removeSelection = () => {
    if (!selection || !hasSelection) return;
    applyRange(selection.start, selection.end, false);
    toast.success(`Trimmed ${formatClock(selection.start)}–${formatClock(selection.end)} out of the video.`);
    setSelection(null);
  };

  const keepSelection = () => {
    if (!selection || !hasSelection) return;
    applyRange(selection.start, selection.end, true);
    toast.success("Kept that section in the video.");
    setSelection(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Manual trim</h3>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Cut any stretch out of the video yourself — not just whole blocks. Move the playhead to where the part starts,
          hit <span className="text-white">Set start</span>, move to where it ends, hit <span className="text-white">Set end</span>,
          then remove it.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-[var(--muted-foreground)]">Playhead</span>
          <span className="tabular-nums text-white">{formatClock(time)}</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[var(--muted-foreground)]">Selection</span>
          <span className="tabular-nums text-white">
            {hasSelection && selection ? (
              <>
                {formatClock(selection.start)} → {formatClock(selection.end)}{" "}
                <span className="text-sky-300">({(selection.end - selection.start).toFixed(1)}s)</span>
              </>
            ) : (
              <span className="text-[var(--muted-foreground)]">nothing selected yet</span>
            )}
          </span>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1 px-2 text-xs" onClick={setStartHere}>
          Set start
        </Button>
        <Button variant="secondary" className="flex-1 px-2 text-xs" onClick={setEndHere}>
          Set end
        </Button>
      </div>

      {hasSelection && selection && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => seek(selection.start)}
            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] transition hover:text-white"
          >
            Jump to selection
          </button>
          <button
            type="button"
            onClick={() => setSelection(null)}
            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)] transition hover:text-white"
          >
            Clear
          </button>
        </div>
      )}

      {inHook && (
        <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Heads up: the hook always plays in full, so any part of this selection inside the hook window (
          {(project.hook.start ?? 0).toFixed(1)}s–{project.hook.end.toFixed(1)}s) won&apos;t be trimmed.
        </p>
      )}

      <div className="flex gap-2">
        <Button variant="danger" className="flex-1 gap-2" disabled={!hasSelection} onClick={removeSelection}>
          <Slice className="h-4 w-4" /> Remove section
        </Button>
        <Button variant="secondary" className="flex-1" disabled={!hasSelection} onClick={keepSelection}>
          Keep section
        </Button>
      </div>

      <Field label="Your manual trims" hint={`${manualCuts.length} removed`}>
        <div className="space-y-1.5">
          {manualCuts.length === 0 && (
            <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-xs text-[var(--muted-foreground)]">
              No manual trims yet. Anything you remove here shows up in this list so you can put it back.
            </p>
          )}
          {manualCuts.map((segment) => (
            <div
              key={segment.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs"
            >
              <button
                type="button"
                onClick={() => seek(Math.max(0, segment.start))}
                className="flex-1 text-left text-[var(--muted-foreground)] transition hover:text-white"
                title="Jump to this trim"
              >
                {formatClock(segment.start)}–{formatClock(segment.end)} · {(segment.end - segment.start).toFixed(1)}s removed
              </button>
              <KeepToggle
                kept={false}
                onChange={() => applyRange(segment.start, segment.end, true)}
              />
            </div>
          ))}
        </div>
      </Field>
    </div>
  );
}

function ImagesPanel({
  project,
  time,
  imageUrl,
  selectedOverlayId,
  setSelectedOverlayId,
  uploadImage,
  updateOverlay,
  removeOverlay,
  seek
}: {
  project: LongformProject;
  time: number;
  imageUrl: (overlay: LongformOverlay) => string;
  selectedOverlayId: string | null;
  setSelectedOverlayId: (id: string | null) => void;
  uploadImage: (file: File, startSec: number) => void;
  updateOverlay: (id: string, partial: Partial<LongformOverlay>) => void;
  removeOverlay: (id: string) => void;
  seek: (t: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const overlays = [...project.overlays].sort((a, b) => a.start - b.start);
  const duration = project.durationSec;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Images</h3>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Drop an image straight onto the timeline, or add one here. Drag it along the image track to time it, and drag
          the edges to change how long it stays. Position and size it below.
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          for (const file of files) uploadImage(file, time);
          event.target.value = "";
        }}
      />
      <Button variant="secondary" className="w-full gap-2" onClick={() => fileRef.current?.click()}>
        <ImagePlus className="h-4 w-4" /> Add image at playhead
      </Button>

      <Field label="On the timeline" hint={`${overlays.length} image${overlays.length === 1 ? "" : "s"}`}>
        <div className="space-y-1.5">
          {overlays.length === 0 && (
            <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-xs text-[var(--muted-foreground)]">
              No images yet — drop a PNG/JPG onto the timeline or use the button above.
            </p>
          )}
          {overlays.map((overlay) => {
            const selected = overlay.id === selectedOverlayId;
            const span = Math.max(0.2, overlay.end - overlay.start);
            return (
              <div
                key={overlay.id}
                className={cn(
                  "rounded-lg border transition",
                  selected ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)]"
                )}
              >
                <div className="flex items-center gap-2 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl(overlay)}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-md border border-[var(--border)] object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedOverlayId(selected ? null : overlay.id);
                      seek(overlay.start + 0.01);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm text-white">{overlay.fileName}</span>
                    <span className="block text-xs text-[var(--muted-foreground)]">
                      {formatClock(overlay.start)}–{formatClock(overlay.end)} · {span.toFixed(1)}s
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeOverlay(overlay.id)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition hover:border-red-400/60 hover:text-red-400"
                    aria-label="Remove image"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {selected && (
                  <div className="space-y-3 border-t border-[var(--border)] p-3">
                    <RangeField
                      label="Start"
                      value={overlay.start}
                      min={0}
                      max={Math.max(0, duration - 0.2)}
                      step={0.1}
                      onChange={(v) =>
                        updateOverlay(overlay.id, {
                          start: Math.round(v * 1000) / 1000,
                          end: Math.round(Math.min(duration, v + span) * 1000) / 1000
                        })
                      }
                      format={(v) => formatClock(v)}
                    />
                    <RangeField
                      label="Duration"
                      value={span}
                      min={0.2}
                      max={Math.max(0.5, duration - overlay.start)}
                      step={0.1}
                      onChange={(v) =>
                        updateOverlay(overlay.id, {
                          end: Math.round(Math.min(duration, overlay.start + v) * 1000) / 1000
                        })
                      }
                      format={(v) => `${v.toFixed(1)}s`}
                    />
                    <RangeField
                      label="Horizontal"
                      value={overlay.x}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(v) => updateOverlay(overlay.id, { x: v })}
                      format={(v) => `${Math.round(v * 100)}%`}
                    />
                    <RangeField
                      label="Vertical"
                      value={overlay.y}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(v) => updateOverlay(overlay.id, { y: v })}
                      format={(v) => `${Math.round(v * 100)}%`}
                    />
                    <RangeField
                      label="Size"
                      value={overlay.width}
                      min={0.05}
                      max={1}
                      step={0.01}
                      onChange={(v) => updateOverlay(overlay.id, { width: v })}
                      format={(v) => `${Math.round(v * 100)}%`}
                    />
                    <RangeField
                      label="Opacity"
                      value={overlay.opacity}
                      min={0.1}
                      max={1}
                      step={0.01}
                      onChange={(v) => updateOverlay(overlay.id, { opacity: v })}
                      format={(v) => `${Math.round(v * 100)}%`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Field>
    </div>
  );
}

function MusicPanel({
  project,
  time,
  selectedAudioId,
  setSelectedAudioId,
  patchMusic,
  patchSfx,
  addAudioClip,
  updateAudioClip,
  removeAudioClip,
  duplicateAudioClip,
  seek
}: {
  project: LongformProject;
  time: number;
  selectedAudioId: string | null;
  setSelectedAudioId: (id: string | null) => void;
  patchMusic: (partial: Partial<LongformProject["music"]>) => void;
  patchSfx: (sfx: NonNullable<LongformProject["sfx"]>) => void;
  addAudioClip: (track: MusicTrack, startSec: number) => void;
  updateAudioClip: (id: string, partial: Partial<LongformAudioClip>) => void;
  removeAudioClip: (id: string) => void;
  duplicateAudioClip: (id: string) => void;
  seek: (t: number) => void;
}) {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [auditionId, setAuditionId] = useState<string | null>(null);
  const dragDepth = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const auditionRef = useRef<HTMLAudioElement | null>(null);
  const music = project.music;
  const clips = [...(music.clips ?? [])].sort((a, b) => a.start - b.start);
  const trackName = (id: string) => tracks.find((t) => t.id === id)?.fileName;

  const refresh = useCallback(async () => {
    const response = await fetch("/api/longform/music", { cache: "no-store" });
    if (!response.ok) return;
    const { tracks: list } = (await response.json()) as { tracks?: MusicTrack[] };
    if (Array.isArray(list)) setTracks(list);
  }, []);

  // Initial library load; failures stay silent — the panel just shows empty.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/longform/music", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { tracks?: MusicTrack[] } | null) => {
        if (!cancelled && data && Array.isArray(data.tracks)) setTracks(data.tracks);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Stop the audition player when the panel unmounts.
  useEffect(() => () => auditionRef.current?.pause(), []);

  const toggleAudition = (track: MusicTrack) => {
    const el = auditionRef.current;
    if (!el) return;
    if (auditionId === track.id) {
      el.pause();
      setAuditionId(null);
      return;
    }
    el.src = `/api/longform/music/${track.id}`;
    void el.play().then(() => setAuditionId(track.id)).catch(() => setAuditionId(null));
  };

  const uploadTrack = async (file: File): Promise<MusicTrack | null> => {
    const isVideo = file.type.startsWith("video/");
    setUploading(true);
    setExtracting(isVideo);
    try {
      const response = await fetch(`/api/longform/music?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "audio/mpeg" },
        body: file
      });
      const data = (await response.json()) as { track?: MusicTrack; error?: string };
      if (!response.ok || !data.track) {
        toast.error(data.error ?? "Upload failed.");
        return null;
      }
      const how = isVideo ? "Extracted audio from" : "Added";
      toast.success(`${how} “${data.track.fileName}” to your library.`);
      return data.track;
    } catch {
      toast.error("Upload failed. Is the dev server still running?");
      return null;
    } finally {
      setUploading(false);
      setExtracting(false);
    }
  };

  // Accept one or more dropped/picked files into the library. Audio uploads
  // as-is; a video has its audio extracted server-side. The last successful
  // track is placed on the timeline at the playhead so it's ready to move.
  const acceptFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []).filter(
      (file) => file.type.startsWith("audio/") || file.type.startsWith("video/")
    );
    if (files.length === 0) {
      if (list && list.length > 0) toast.error("Drop an audio or video file.");
      return;
    }
    let last: MusicTrack | null = null;
    for (const file of files) {
      const track = await uploadTrack(file);
      if (track) last = track;
    }
    if (last) addAudioClip(last, time);
    await refresh();
  };

  const removeTrack = async (track: MusicTrack) => {
    try {
      if (auditionId === track.id) {
        auditionRef.current?.pause();
        setAuditionId(null);
      }
      await fetch(`/api/longform/music/${track.id}`, { method: "DELETE" });
      // Drop any placed clips that referenced the deleted track.
      for (const clip of music.clips ?? []) {
        if (clip.trackId === track.id) removeAudioClip(clip.id);
      }
      await refresh();
    } catch {
      toast.error("Could not delete that song.");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Audio</h3>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Balance the mix that gets baked into the export, then drop songs onto the audio track at the bottom. Drag a clip
          anywhere, drag its edges to change its length, duplicate it to repeat it, and give each clip its own volume dial.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
        <RangeField
          label="Master volume"
          value={music.masterVolume ?? 1}
          min={0}
          max={2}
          step={0.01}
          onChange={(v) => patchMusic({ masterVolume: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <RangeField
          label="Video volume"
          value={music.videoVolume ?? 1}
          min={0}
          max={2}
          step={0.01}
          onChange={(v) => patchMusic({ videoVolume: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        {!project.hasAudio && (
          <p className="text-[10px] text-amber-300/80">
            This upload has no audio of its own, so the video level has no effect.
          </p>
        )}
      </div>

      <SfxSection value={project.sfx} onChange={patchSfx} />

      {/* Hidden audition player for previewing library tracks. */}
      <audio ref={auditionRef} hidden onEnded={() => setAuditionId(null)} />

      <input
        ref={fileRef}
        type="file"
        accept="audio/*,video/*"
        multiple
        className="hidden"
        onChange={(event) => {
          void acceptFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <div
        role="button"
        tabIndex={0}
        onClick={() => !uploading && fileRef.current?.click()}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !uploading) fileRef.current?.click();
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (!uploading) void acceptFiles(event.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition",
          dragging
            ? "border-[var(--accent)] bg-[var(--accent)]/10"
            : "border-[var(--border)] hover:border-[var(--border-strong)]",
          uploading && "pointer-events-none opacity-70"
        )}
      >
        {uploading ? (
          <Loader2 className="h-6 w-6 animate-spin text-[var(--accent)]" />
        ) : (
          <UploadCloud className="h-6 w-6 text-[var(--accent)]" />
        )}
        <div>
          <p className="text-sm font-medium text-white">
            {extracting ? "Extracting audio…" : uploading ? "Uploading…" : "Drop a song here or click to browse"}
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            MP3, WAV, or a video — we keep just the audio
          </p>
        </div>
      </div>

      {/* Placed audio clips on the timeline. */}
      <Field label="On the timeline" hint={`${clips.length} clip${clips.length === 1 ? "" : "s"}`}>
        <div className="space-y-1.5">
          {clips.length === 0 && (
            <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-xs text-[var(--muted-foreground)]">
              Nothing placed yet — add a song from your library below, or drop one onto the audio track.
            </p>
          )}
          {clips.map((clip) => {
            const selected = clip.id === selectedAudioId;
            return (
              <div
                key={clip.id}
                className={cn(
                  "rounded-lg border transition",
                  selected ? "border-emerald-400 bg-emerald-400/10" : "border-[var(--border)]"
                )}
              >
                <div className="flex items-center gap-2 p-2">
                  <Music4 className="h-4 w-4 shrink-0 text-emerald-300" />
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAudioId(selected ? null : clip.id);
                      seek(clip.start + 0.01);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm text-white">{trackName(clip.trackId) ?? clip.fileName}</span>
                    <span className="block text-xs text-[var(--muted-foreground)]">
                      {formatClock(clip.start)} · {clip.duration.toFixed(1)}s · {Math.round(clip.volume * 100)}%
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicateAudioClip(clip.id)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition hover:text-white"
                    aria-label="Duplicate clip"
                    title="Duplicate this clip"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeAudioClip(clip.id)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition hover:border-red-400/60 hover:text-red-400"
                    aria-label="Remove clip"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {selected && (
                  <div className="border-t border-[var(--border)] p-3">
                    <RangeField
                      label="Volume"
                      value={clip.volume}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(v) => updateAudioClip(clip.id, { volume: v })}
                      format={(v) => `${Math.round(v * 100)}%`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Field>

      {clips.length > 0 && (
        <Toggle label="Mix audio into the export" checked={music.enabled} onChange={(v) => patchMusic({ enabled: v })} />
      )}

      <Field label="Your library" hint={`${tracks.length} song${tracks.length === 1 ? "" : "s"}`}>
        <div className="space-y-1.5">
          {tracks.length === 0 && (
            <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-xs text-[var(--muted-foreground)]">
              No songs yet — upload an MP3/WAV to get started.
            </p>
          )}
          {tracks.map((track) => {
            const auditioning = auditionId === track.id;
            return (
              <div key={track.id} className="rounded-lg border border-[var(--border)] px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleAudition(track)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition hover:text-white"
                    aria-label={auditioning ? "Stop preview" : "Preview song"}
                  >
                    {auditioning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 translate-x-px" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-white">{track.fileName}</span>
                    <span className="block text-xs text-[var(--muted-foreground)]">
                      {track.durationSec > 0 ? formatClock(track.durationSec) : "audio"} ·{" "}
                      {(track.sizeBytes / 1_000_000).toFixed(1)} MB
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => addAudioClip(track, time)}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--accent)]/60 bg-[var(--accent)]/10 px-2 py-1 text-xs font-medium text-white transition hover:bg-[var(--accent)]/20"
                    title="Place this song on the timeline at the playhead"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeTrack(track)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition hover:border-red-400/60 hover:text-red-400"
                    aria-label="Delete song"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Field>
    </div>
  );
}

/**
 * Publish kit: Claude-written title options, a full YouTube description and
 * tags for this edit, per the channel metadata conventions. Everything is
 * copy-to-clipboard so the upload form is a paste away.
 */
function PublishPanel({
  project,
  setProject,
  skipDirtyRef
}: {
  project: LongformProject;
  setProject: React.Dispatch<React.SetStateAction<LongformProject>>;
  skipDirtyRef: React.MutableRefObject<boolean>;
}) {
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const metadata = project.metadata;

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1500);
    } catch {
      toast.error("Clipboard unavailable — select and copy the text manually.");
    }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const response = await fetch(`/api/longform/projects/${project.id}/metadata`, { method: "POST" });
      const data = (await response.json()) as { metadata?: LongformVideoMetadata; error?: string };
      if (!response.ok || !data.metadata) {
        toast.error(data.error ?? "Could not generate the publish kit.");
        return;
      }
      skipDirtyRef.current = true;
      setProject((current) => ({ ...current, metadata: data.metadata }));
      toast.success(
        data.metadata.source === "ai"
          ? "Publish kit written — titles, description and tags are ready."
          : "Publish kit built offline (AI-written metadata was unavailable)."
      );
    } catch {
      toast.error("Could not generate the publish kit.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Publish kit</h3>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Viral title options, a full YouTube description{metadata?.chapters.length ? " with chapters" : ""} and tags —
          written in the channel voice from this edit&apos;s transcript, ready to paste into the upload form.
        </p>
      </div>

      <Button className="w-full gap-2" disabled={generating} onClick={() => void generate()}>
        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {generating ? "Writing…" : metadata ? "Regenerate publish kit" : "Generate titles & description"}
      </Button>

      {metadata && (
        <>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Titles · pick one
            </p>
            {metadata.titles.map((title, index) => (
              <div
                key={`${index}-${title}`}
                className="flex items-start justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
              >
                <p className="text-sm text-white/90">{title}</p>
                <button
                  type="button"
                  className="shrink-0 text-[var(--muted-foreground)] transition hover:text-white"
                  title="Copy title"
                  onClick={() => void copy(`title-${index}`, title)}
                >
                  {copied === `title-${index}` ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Description</p>
              <Button variant="secondary" className="gap-1.5 px-2.5 py-1 text-xs" onClick={() => void copy("description", metadata.description)}>
                {copied === "description" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy
              </Button>
            </div>
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2 font-sans text-xs leading-relaxed text-white/85">
              {metadata.description}
            </pre>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Tags · {metadata.tags.length}
              </p>
              <Button variant="secondary" className="gap-1.5 px-2.5 py-1 text-xs" onClick={() => void copy("tags", metadata.tags.join(", "))}>
                {copied === "tags" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Copy all
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {metadata.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-white/80">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <p className="text-xs text-[var(--muted-foreground)]">
            {metadata.source === "ai" ? "Written by Claude in the channel voice" : "Built offline from the channel keywords"} ·{" "}
            {new Date(metadata.generatedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}

function ExportPanel({
  project,
  setProject,
  skipDirtyRef,
  onDeleted,
  editedSec
}: {
  project: LongformProject;
  setProject: React.Dispatch<React.SetStateAction<LongformProject>>;
  skipDirtyRef: React.MutableRefObject<boolean>;
  onDeleted: () => void;
  editedSec: number;
}) {
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [extracting, setExtracting] = useState<string | null>(null);
  const active = project.exports.find((record) => record.status === "processing");
  const latestDone = project.exports.find((record) => record.status === "done" && record.file);

  // Poll while an export renders. State comes back through the project so a
  // restarted panel picks the render right back up.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      void fetch(`/api/longform/projects/${project.id}/export/${active.id}`, { cache: "no-store" })
        .then((response) => response.json())
        .then((data: { export?: LongformExportRecord; error?: string }) => {
          if (!data.export) return;
          const record = data.export;
          skipDirtyRef.current = true;
          setProject((current) => ({
            ...current,
            exports: current.exports.map((item) => (item.id === record.id ? record : item))
          }));
          if (record.status === "done") toast.success("Your edited video is ready.");
          if (record.status === "error") toast.error(record.error ?? "Export failed.");
        })
        .catch(() => undefined);
    }, 1200);
    return () => clearInterval(timer);
  }, [active, project.id, setProject, skipDirtyRef]);

  const startExport = async () => {
    setStarting(true);
    try {
      const response = await fetch(`/api/longform/projects/${project.id}/export`, { method: "POST" });
      const data = (await response.json()) as { export?: LongformExportRecord; error?: string };
      if (!response.ok || !data.export) {
        toast.error(data.error ?? "Could not start the export.");
        return;
      }
      skipDirtyRef.current = true;
      setProject((current) => ({ ...current, exports: [data.export!, ...current.exports.filter((e) => e.id !== data.export!.id)] }));
    } catch {
      toast.error("Could not start the export.");
    } finally {
      setStarting(false);
    }
  };

  const stopExport = async () => {
    if (!active) return;
    setStopping(true);
    try {
      const response = await fetch(`/api/longform/projects/${project.id}/export/${active.id}`, { method: "DELETE" });
      const data = (await response.json()) as { export?: LongformExportRecord; error?: string };
      if (!response.ok || !data.export) {
        toast.error(data.error ?? "Could not stop the export.");
        return;
      }
      skipDirtyRef.current = true;
      setProject((current) => ({
        ...current,
        exports: current.exports.map((item) => (item.id === data.export!.id ? data.export! : item))
      }));
      toast("Render stopped.");
    } catch {
      toast.error("Could not stop the export.");
    } finally {
      setStopping(false);
    }
  };

  const sendToClips = async (record: LongformExportRecord) => {
    setSending(record.id);
    try {
      const response = await fetch(`/api/longform/projects/${project.id}/send-to-clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exportId: record.id })
      });
      const data = (await response.json()) as { job?: { id: string }; error?: string };
      if (!response.ok || !data.job) {
        toast.error(data.error ?? "Could not send this export to the Clip Generator.");
        return;
      }
      toast.success("Sent to the Clip Generator — shorts are being cut now.");
    } catch {
      toast.error("Could not send this export to the Clip Generator.");
    } finally {
      setSending(null);
    }
  };

  const extractAudio = async (record: LongformExportRecord) => {
    setExtracting(record.id);
    try {
      const response = await fetch(`/api/longform/projects/${project.id}/export/${record.id}/audio`, { method: "POST" });
      const data = (await response.json()) as { export?: LongformExportRecord; error?: string };
      if (!response.ok || !data.export) {
        toast.error(data.error ?? "Could not create the audio version.");
        return;
      }
      skipDirtyRef.current = true;
      setProject((current) => ({
        ...current,
        exports: current.exports.map((item) => (item.id === data.export!.id ? data.export! : item))
      }));
      toast.success("Audio version ready — download the mp3 for Spotify / podcast platforms.");
    } catch {
      toast.error("Could not create the audio version.");
    } finally {
      setExtracting(null);
    }
  };

  const fileUrl = (record: LongformExportRecord, download = false) =>
    `/api/longform/projects/${project.id}/export/${record.id}?file=1${download ? "&download=1" : ""}`;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Export</h3>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Bakes the hook, the cuts and the music into one{" "}
          {(project.layout ?? "wide") === "vertical" ? "9:16 vertical" : "1080p"} file — then send it straight to the
          Clip Generator for shorts.
        </p>
      </div>

      <div className="space-y-1 rounded-lg border border-[var(--border)] px-3 py-2.5 text-xs text-[var(--muted-foreground)]">
        <p>
          Runtime <span className="float-right text-white">{formatClock(editedSec)}</span>
        </p>
        <p>
          Layout{" "}
          <span className="float-right text-white">
            {(project.layout ?? "wide") === "vertical" ? "9:16 · centered + blur" : "16:9 · 1080p"}
          </span>
        </p>
        <p>
          Hook{" "}
          <span className="float-right text-white">
            {project.hook.enabled
              ? `${(project.hook.end - (project.hook.start ?? 0)).toFixed(1)}s · ${project.hook.zoom.toFixed(2)}x zoom`
              : "off"}
          </span>
        </p>
        <p>
          Captions{" "}
          <span className="float-right text-white">
            {project.captions.enabled ? `${project.captions.segments.filter((s) => s.enabled).length} segments` : "off"}
          </span>
        </p>
        <p>
          Cuts <span className="float-right text-white">{project.segments.filter((s) => !s.enabled).length} removed</span>
        </p>
        <p>
          Audio{" "}
          <span className="float-right text-white">
            {project.music.enabled && (project.music.clips?.length ?? 0) > 0
              ? `${project.music.clips.length} clip${project.music.clips.length === 1 ? "" : "s"}`
              : "off"}
          </span>
        </p>
      </div>

      {active ? (
        <div className="space-y-2">
          <Progress value={active.progress} />
          <p className="text-center text-xs text-[var(--muted-foreground)]">Rendering… {active.progress}%</p>
          <Button variant="danger" className="w-full gap-2" disabled={stopping} onClick={() => void stopExport()}>
            {stopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            Stop render
          </Button>
        </div>
      ) : (
        <Button className="w-full gap-2" disabled={starting} onClick={() => void startExport()}>
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Export edited video
        </Button>
      )}

      {latestDone && !active && (
        <div className="space-y-2 border-t border-[var(--border)] pt-4">
          <video controls preload="metadata" src={fileUrl(latestDone)} className="w-full rounded-lg border border-[var(--border)] bg-black" />
          <div className="flex gap-2">
            <a
              href={fileUrl(latestDone, true)}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-white transition hover:border-[var(--border-strong)]"
            >
              <Download className="h-4 w-4" /> Download
            </a>
            <Button className="flex-1 gap-2" disabled={sending === latestDone.id} onClick={() => void sendToClips(latestDone)}>
              {sending === latestDone.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Make shorts
            </Button>
          </div>
          {latestDone.audioFile ? (
            <a
              href={`/api/longform/projects/${project.id}/export/${latestDone.id}/audio?download=1`}
              className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-white transition hover:border-[var(--border-strong)]"
            >
              <AudioLines className="h-4 w-4" /> Download audio (mp3)
            </a>
          ) : (
            <Button
              variant="secondary"
              className="w-full gap-2"
              disabled={extracting === latestDone.id}
              onClick={() => void extractAudio(latestDone)}
            >
              {extracting === latestDone.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioLines className="h-4 w-4" />}
              Create audio version (mp3)
            </Button>
          )}
          <p className="text-center text-xs text-[var(--muted-foreground)]">
            “Make shorts” drops this edit into the{" "}
            <Link href="/clips" className="text-[var(--accent)] underline-offset-2 hover:underline">
              Clip Generator
            </Link>
            ; the audio version is the same edit as an mp3 for Spotify / podcasts.
          </p>
        </div>
      )}

      {project.exports.some((record) => record.status === "error") && (
        <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {project.exports.find((record) => record.status === "error")?.error}
        </p>
      )}

      <div className="border-t border-[var(--border)] pt-3">
        <Button
          variant="danger"
          className="w-full gap-2"
          onClick={async () => {
            if (!window.confirm("Delete this project? Exports are removed too — the original upload stays.")) return;
            const response = await fetch(`/api/longform/projects/${project.id}`, { method: "DELETE" });
            if (response.ok) onDeleted();
            else toast.error("Could not delete this project.");
          }}
        >
          <Trash2 className="h-4 w-4" /> Delete project
        </Button>
      </div>
    </div>
  );
}
