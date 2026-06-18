"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Copy,
  Loader2,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAppData } from "@/components/providers/app-provider";
import type { AspectPreset, ClipFraming, VideoClip, VideoProject } from "@/types/domain";
import { cn } from "@/lib/utils";
import { Preview } from "./preview";
import { Timeline } from "./timeline";
import { PropertiesPanel } from "./properties-panel";
import { useHistory } from "./use-history";
import { useTimelinePlayer } from "./use-timeline-player";
import {
  ASPECT_PRESETS,
  EXPORT_PRESETS,
  formatTimecode,
  getFraming,
  LAYOUT_PRESETS,
  locateTime,
  makeClip,
  makeProject,
  parseTimecode,
  sourceFromMeta,
  streamUrl,
  waveformUrl,
  withFraming,
  computeSegments
} from "./presets";

const ZOOM_LEVELS = [2, 4, 6, 10, 16, 24, 40, 60, 100, 160];

// --- Project gallery -------------------------------------------------------

function Gallery({
  projects,
  onOpen,
  onNew,
  onDuplicate,
  onDelete
}: {
  projects: VideoProject[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onDuplicate: (p: VideoProject) => void;
  onDelete: (p: VideoProject) => void;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Editor projects</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Non-destructive timeline projects. Your source video is stored once; only the edit instructions are saved.
          </p>
        </div>
        <Button onClick={onNew}>
          <Plus className="mr-2 h-4 w-4" />
          New project
        </Button>
      </div>

      {projects.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--muted-foreground)]">
          No projects yet. Create one, import a video, and start trimming.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => {
            const segs = computeSegments(project.clips);
            return (
              <div
                key={project.id}
                className="flex flex-col justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4"
              >
                <button type="button" onClick={() => onOpen(project.id)} className="text-left">
                  <p className="truncate text-sm font-semibold text-white">{project.name}</p>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {project.aspect.preset} · {project.clips.length} clip{project.clips.length === 1 ? "" : "s"} ·{" "}
                    {formatTimecode(segs.total)}
                  </p>
                  <p className="mt-1 truncate text-xs text-[var(--muted-foreground)]">
                    {project.source ? project.source.fileName : "No source imported"}
                  </p>
                  <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
                    Updated {new Date(project.updatedAt).toLocaleString()}
                  </p>
                </button>
                <div className="mt-3 flex gap-2">
                  <Button variant="secondary" className="flex-1 px-2 py-1.5 text-xs" onClick={() => onOpen(project.id)}>
                    Open
                  </Button>
                  <Button variant="ghost" className="px-2 py-1.5" title="Duplicate" onClick={() => onDuplicate(project)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" className="px-2 py-1.5 text-red-300" title="Delete" onClick={() => onDelete(project)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// --- Import zone -----------------------------------------------------------

function ImportZone({
  uploading,
  onFile,
  onUrl
}: {
  uploading: boolean;
  onFile: (file: File) => void;
  onUrl: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  return (
    <Card>
      <h3 className="text-sm font-semibold text-white">Import a video</h3>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Upload a file (Short or a ~90-minute livestream). It streams to storage and plays back without loading the whole
        file into the browser.
      </p>
      <div
        className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-8 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
      >
        {uploading ? (
          <Loader2 className="h-6 w-6 animate-spin text-[var(--accent)]" />
        ) : (
          <Upload className="h-6 w-6 text-[var(--accent)]" />
        )}
        <p className="mt-3 text-sm text-white">{uploading ? "Uploading & probing…" : "Drag a video here, or"}</p>
        <Button variant="secondary" className="mt-3" disabled={uploading} onClick={() => inputRef.current?.click()}>
          Choose file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="…or paste a direct, playable video URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button variant="secondary" disabled={!url.trim()} onClick={() => onUrl(url.trim())}>
          Use URL
        </Button>
      </div>
    </Card>
  );
}

// --- Main editor -----------------------------------------------------------

export function ClipEditor() {
  const { data, mutate } = useAppData();
  const projects = data.videoProjects;

  const { state: project, set, setLive, commitChange, undo, redo, reset, canUndo, canRedo, version } =
    useHistory<VideoProject | null>(null);
  const projectRef = useRef<VideoProject | null>(null);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const [pxPerSecond, setPxPerSecond] = useState(10);
  const [uploading, setUploading] = useState(false);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [showSafe, setShowSafe] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");

  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedRef = useRef<string>("");
  const dragSnap = useRef<VideoProject | null>(null);

  const clips = useMemo(() => project?.clips ?? [], [project]);
  const player = useTimelinePlayer(videoRef, clips);
  const src = streamUrl(project?.source ?? null);

  const aspect = project?.aspect ?? { preset: "9:16" as AspectPreset, w: 9, h: 16 };

  // The clip being previewed and edited follows the playhead, so multi-clip
  // playback always shows each clip's own framing. Selecting a clip seeks to it.
  const selectedClip = useMemo(() => {
    if (!project) return null;
    return clips[player.activeIndex] ?? clips[0] ?? null;
  }, [project, clips, player.activeIndex]);

  // --- Persistence ---
  const persist = useCallback(async () => {
    const p = projectRef.current;
    if (!p) return;
    const json = JSON.stringify(p);
    if (json === lastSavedRef.current) {
      setSaveStatus("saved");
      return;
    }
    setSaveStatus("saving");
    await mutate("upsertVideoProject", p);
    lastSavedRef.current = json;
    setSaveStatus("saved");
  }, [mutate]);

  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  // Autosave only on committed edits (version bumps; live drags don't bump).
  useEffect(() => {
    if (!project) return;
    const json = JSON.stringify(project);
    if (json === lastSavedRef.current) return;
    setSaveStatus("unsaved");
    const timer = setTimeout(() => void persistRef.current(), 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // --- Core update helpers (live vs committed, with drag coalescing) ---
  const applyProject = useCallback(
    (next: VideoProject, commit: boolean) => {
      const stamped = { ...next, updatedAt: new Date().toISOString() };
      if (commit) {
        if (dragSnap.current) {
          commitChange(dragSnap.current, stamped);
          dragSnap.current = null;
        } else {
          set(stamped);
        }
      } else {
        if (!dragSnap.current) dragSnap.current = projectRef.current;
        setLive(stamped);
      }
    },
    [commitChange, set, setLive]
  );

  const patchProject = useCallback(
    (patch: Partial<VideoProject>, commit = true) => {
      if (!projectRef.current) return;
      applyProject({ ...projectRef.current, ...patch }, commit);
    },
    [applyProject]
  );

  const replaceClips = useCallback(
    (clipsNext: VideoClip[], commit = true) => {
      if (!projectRef.current) return;
      applyProject({ ...projectRef.current, clips: clipsNext }, commit);
    },
    [applyProject]
  );

  const updateClip = useCallback(
    (clipId: string, patch: Partial<VideoClip>, commit = true) => {
      const p = projectRef.current;
      if (!p) return;
      replaceClips(
        p.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
        commit
      );
    },
    [replaceClips]
  );

  const updateSelected = useCallback(
    (patch: Partial<VideoClip>, commit: boolean) => {
      if (selectedClip) updateClip(selectedClip.id, patch, commit);
    },
    [selectedClip, updateClip]
  );

  const updateFraming = useCallback(
    (patch: Partial<ClipFraming>, commit: boolean) => {
      const p = projectRef.current;
      if (!p || !selectedClip) return;
      const next = { ...getFraming(selectedClip, p.aspect), ...patch };
      replaceClips(
        p.clips.map((c) => (c.id === selectedClip.id ? withFraming(c, p.aspect, next) : c)),
        commit
      );
    },
    [replaceClips, selectedClip]
  );

  const setFramingValue = useCallback(
    (value: ClipFraming, commit: boolean) => {
      const p = projectRef.current;
      if (!p || !selectedClip) return;
      replaceClips(
        p.clips.map((c) => (c.id === selectedClip.id ? withFraming(c, p.aspect, value) : c)),
        commit
      );
    },
    [replaceClips, selectedClip]
  );

  const applyLayout = useCallback(
    (presetId: string) => {
      const p = projectRef.current;
      if (!p || !selectedClip) return;
      const preset = LAYOUT_PRESETS.find((x) => x.id === presetId);
      if (!preset) return;
      replaceClips(
        p.clips.map((c) => (c.id === selectedClip.id ? preset.apply(c, p.aspect) : c)),
        true
      );
    },
    [replaceClips, selectedClip]
  );

  // --- Timeline operations ---
  const seekSoon = useCallback(
    (t: number) => {
      // Let the clips state commit (player refs update in an effect) before seeking.
      setTimeout(() => player.seek(t), 0);
    },
    [player]
  );

  const addWholeVideo = useCallback(() => {
    const p = projectRef.current;
    if (!p?.source) return;
    const dur = p.source.durationSec || videoRef.current?.duration || 0;
    if (!dur) {
      toast.error("Still reading the video length — try again in a moment.");
      return;
    }
    const clip = makeClip({ sourceStart: 0, sourceEnd: dur });
    const start = computeSegments(p.clips).total;
    replaceClips([...p.clips, clip], true);
    seekSoon(start + 0.001);
  }, [replaceClips, seekSoon]);

  const splitAtPlayhead = useCallback(() => {
    const p = projectRef.current;
    if (!p) return;
    const segments = computeSegments(p.clips);
    const located = locateTime(p.clips, segments, player.currentTime);
    if (!located) return;
    const { clip, sourceTime, index } = located;
    if (sourceTime <= clip.sourceStart + 0.1 || sourceTime >= clip.sourceEnd - 0.1) {
      toast.error("Move the playhead inside a clip to split it.");
      return;
    }
    const left = { ...clip, sourceEnd: sourceTime };
    const right = makeClip({
      ...clip,
      id: `clip-${crypto.randomUUID().slice(0, 8)}`,
      sourceStart: sourceTime,
      sourceEnd: clip.sourceEnd
    });
    const next = [...p.clips];
    next.splice(index, 1, left, right);
    replaceClips(next, true);
  }, [player.currentTime, replaceClips]);

  const deleteSelected = useCallback(() => {
    const p = projectRef.current;
    if (!p || !selectedClip) return;
    replaceClips(
      p.clips.filter((c) => c.id !== selectedClip.id),
      true
    );
  }, [replaceClips, selectedClip]);

  const duplicateSelected = useCallback(() => {
    const p = projectRef.current;
    if (!p || !selectedClip) return;
    const index = p.clips.findIndex((c) => c.id === selectedClip.id);
    const copy = makeClip({ ...selectedClip, id: `clip-${crypto.randomUUID().slice(0, 8)}` });
    const next = [...p.clips];
    next.splice(index + 1, 0, copy);
    const start = computeSegments(next).starts[index + 1];
    replaceClips(next, true);
    seekSoon(start + 0.001);
  }, [replaceClips, selectedClip, seekSoon]);

  const reorder = useCallback(
    (from: number, to: number) => {
      const p = projectRef.current;
      if (!p) return;
      const next = [...p.clips];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      replaceClips(next, true);
    },
    [replaceClips]
  );

  const selectAndSeek = useCallback(
    (clipId: string) => {
      const p = projectRef.current;
      if (!p) return;
      const segments = computeSegments(p.clips);
      const index = p.clips.findIndex((c) => c.id === clipId);
      if (index >= 0) player.seek(segments.starts[index] + 0.001);
    },
    [player]
  );

  // Trim from timeline drag handles.
  const onTrimLive = useCallback(
    (clipId: string, edge: "start" | "end", sourceTime: number) => {
      updateClip(clipId, edge === "start" ? { sourceStart: sourceTime } : { sourceEnd: sourceTime }, false);
    },
    [updateClip]
  );
  const onTrimCommit = useCallback(() => {
    const p = projectRef.current;
    if (p) applyProject(p, true);
  }, [applyProject]);

  // --- Source import ---
  const importFile = useCallback(
    async (file: File) => {
      const p = projectRef.current;
      if (!p) return;
      setUploading(true);
      try {
        const res = await fetch(`/api/clips/sources?name=${encodeURIComponent(file.name)}`, {
          method: "POST",
          headers: { "Content-Type": file.type || "video/mp4" },
          body: file
        });
        const json = (await res.json()) as { source?: Parameters<typeof sourceFromMeta>[0]; error?: string };
        if (!res.ok || !json.source) {
          toast.error(json.error ?? "Upload failed.");
          return;
        }
        const source = sourceFromMeta(json.source);
        applyProject({ ...projectRef.current!, source, name: p.name === "Untitled project" ? file.name.replace(/\.[^.]+$/, "") : p.name }, true);
        toast.success("Video imported.");
      } catch {
        toast.error("Upload failed — is the dev server running?");
      } finally {
        setUploading(false);
      }
    },
    [applyProject]
  );

  const importUrl = useCallback(
    (url: string) => {
      const p = projectRef.current;
      if (!p) return;
      applyProject(
        {
          ...p,
          source: {
            id: `url-${crypto.randomUUID().slice(0, 8)}`,
            kind: "url",
            fileName: url.split("/").pop() || url,
            url,
            mime: "video/mp4",
            durationSec: 0,
            width: 0,
            height: 0,
            hasAudio: true,
            sizeBytes: 0
          }
        },
        true
      );
    },
    [applyProject]
  );

  // When metadata loads, backfill duration/dims if the server probe missed them.
  const onLoadedMetadata = useCallback(() => {
    player.handleLoaded();
    const p = projectRef.current;
    const video = videoRef.current;
    if (!p?.source || !video) return;
    if (!p.source.durationSec && video.duration) {
      applyProject(
        { ...p, source: { ...p.source, durationSec: video.duration, width: video.videoWidth, height: video.videoHeight } },
        true
      );
    }
  }, [applyProject, player]);

  // Auto-add the whole video as the first clip once a source with a duration exists.
  useEffect(() => {
    const p = projectRef.current;
    if (!p?.source) return;
    if (p.clips.length === 0 && p.source.durationSec > 0) {
      const clip = makeClip({ sourceStart: 0, sourceEnd: p.source.durationSec });
      replaceClips([clip], true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.source?.id, project?.source?.durationSec]);

  // --- Waveform ---
  useEffect(() => {
    const wf = waveformUrl(project?.source ?? null);
    let cancelled = false;
    Promise.resolve(wf ? fetch(wf).then((r) => (r.ok ? r.json() : { peaks: [] })) : { peaks: [] })
      .then((j: { peaks?: number[] }) => {
        if (!cancelled) setWaveform(j.peaks ?? []);
      })
      .catch(() => {
        if (!cancelled) setWaveform([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.source?.id]);

  // --- Project lifecycle ---
  const openProject = useCallback(
    (id: string) => {
      const found = projects.find((p) => p.id === id);
      if (!found) return;
      reset(found);
      lastSavedRef.current = JSON.stringify(found);
      setSaveStatus("saved");
    },
    [projects, reset]
  );

  const newProject = useCallback(() => {
    const created = makeProject();
    void mutate("upsertVideoProject", created);
    reset(created);
    lastSavedRef.current = JSON.stringify(created);
    setSaveStatus("saved");
  }, [mutate, reset]);

  const duplicateProject = useCallback(
    (p: VideoProject) => {
      const copy = makeProject({ ...p, id: undefined, name: `${p.name} copy`, createdAt: undefined, updatedAt: undefined });
      void mutate("upsertVideoProject", copy, { successMessage: "Project duplicated." });
    },
    [mutate]
  );

  const deleteProject = useCallback(
    (p: VideoProject) => {
      if (!window.confirm(`Delete “${p.name}”? The edit instructions are removed; the stored source is kept.`)) return;
      void mutate("deleteVideoProject", p.id, { successMessage: "Project deleted." });
      if (projectRef.current?.id === p.id) reset(null);
    },
    [mutate, reset]
  );

  const closeProject = useCallback(() => {
    void persistRef.current();
    reset(null);
  }, [reset]);

  // --- Aspect / export ---
  const changeAspect = useCallback(
    (preset: AspectPreset) => {
      const opt = ASPECT_PRESETS.find((a) => a.preset === preset);
      if (!opt) return;
      const w = preset === "custom" ? aspect.w : opt.w;
      const h = preset === "custom" ? aspect.h : opt.h;
      patchProject({ aspect: { preset, w, h } }, true);
    },
    [aspect.h, aspect.w, patchProject]
  );

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!projectRef.current) return;
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      switch (e.key) {
        case " ":
          e.preventDefault();
          player.toggle();
          break;
        case "ArrowLeft":
          e.preventDefault();
          player.stepFrame(e.shiftKey ? -1 : -1 / 30);
          break;
        case "ArrowRight":
          e.preventDefault();
          player.stepFrame(e.shiftKey ? 1 : 1 / 30);
          break;
        case "s":
        case "S":
          splitAtPlayhead();
          break;
        case "d":
        case "D":
          duplicateSelected();
          break;
        case "Delete":
        case "Backspace":
          deleteSelected();
          break;
        case "+":
        case "=":
          setPxPerSecond((z) => ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(z) + 1)] ?? z);
          break;
        case "-":
        case "_":
          setPxPerSecond((z) => ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(z) - 1)] ?? z);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [deleteSelected, duplicateSelected, player, redo, splitAtPlayhead, undo]);

  // ---------------------------------------------------------------------------

  if (!project) {
    return <Gallery projects={projects} onOpen={openProject} onNew={newProject} onDuplicate={duplicateProject} onDelete={deleteProject} />;
  }

  const framing = selectedClip ? getFraming(selectedClip, aspect) : null;
  const zoomIn = () => setPxPerSecond((z) => ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(z) + 1)] ?? z);
  const zoomOut = () => setPxPerSecond((z) => ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(z) - 1)] ?? z);

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <Card className="flex flex-wrap items-center gap-3 py-3">
        <Button variant="ghost" className="px-2" onClick={closeProject} title="Back to projects">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <input
          value={project.name}
          onChange={(e) => patchProject({ name: e.target.value || "Untitled project" }, false)}
          onBlur={() => onTrimCommit()}
          className="min-w-[140px] flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-base font-semibold text-white outline-none hover:border-[var(--border)] focus:border-[var(--accent)]"
        />
        <span
          className={cn(
            "text-xs",
            saveStatus === "saved" && "text-emerald-300",
            saveStatus === "saving" && "text-amber-300",
            saveStatus === "unsaved" && "text-[var(--muted-foreground)]"
          )}
        >
          {saveStatus === "saved" ? "All changes saved" : saveStatus === "saving" ? "Saving…" : "Unsaved changes"}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="px-2" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" className="px-2" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button variant="secondary" className="px-3" onClick={() => void persist()}>
            <Save className="mr-2 h-4 w-4" />
            Save
          </Button>
        </div>
      </Card>

      {!project.source ? (
        <ImportZone uploading={uploading} onFile={importFile} onUrl={importUrl} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          {/* Left: preview + transport + timeline */}
          <div className="space-y-3">
            {/* Output settings */}
            <Card className="flex flex-wrap items-center gap-3 py-3">
              <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                Aspect
                <Select
                  value={aspect.preset}
                  onChange={(e) => changeAspect(e.target.value as AspectPreset)}
                  className="h-9 w-auto"
                >
                  {ASPECT_PRESETS.map((a) => (
                    <option key={a.preset} value={a.preset}>
                      {a.label} ({a.hint})
                    </option>
                  ))}
                </Select>
              </label>
              {aspect.preset === "custom" && (
                <div className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                  <Input
                    type="number"
                    value={aspect.w}
                    min={1}
                    onChange={(e) => patchProject({ aspect: { ...aspect, w: Number(e.target.value) || 1 } }, true)}
                    className="h-9 w-16"
                  />
                  :
                  <Input
                    type="number"
                    value={aspect.h}
                    min={1}
                    onChange={(e) => patchProject({ aspect: { ...aspect, h: Number(e.target.value) || 1 } }, true)}
                    className="h-9 w-16"
                  />
                </div>
              )}
              <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                Export
                <Select
                  value={project.exportPreset}
                  onChange={(e) => patchProject({ exportPreset: e.target.value }, true)}
                  className="h-9 w-auto"
                >
                  {EXPORT_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <input type="checkbox" checked={showSafe} onChange={(e) => setShowSafe(e.target.checked)} />
                Safe areas
              </label>
            </Card>

            <Card>
              <Preview
                videoRef={videoRef}
                src={src}
                aspect={aspect}
                clip={selectedClip}
                framing={framing ?? getFraming(makeClip(), aspect)}
                source={project.source}
                showSafeAreas={showSafe}
                onLoadedMetadata={onLoadedMetadata}
                onFramingLive={(f) => setFramingValue(f, false)}
                onFramingCommit={(f) => setFramingValue(f, true)}
              />
            </Card>

            {/* Transport */}
            <Card className="flex flex-wrap items-center gap-2 py-3">
              <Button variant="ghost" className="px-2" onClick={() => player.stepFrame(-1 / 30)} title="Step back">
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button className="px-3" onClick={player.toggle}>
                {player.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" className="px-2" onClick={() => player.stepFrame(1 / 30)} title="Step forward">
                <SkipForward className="h-4 w-4" />
              </Button>
              <SeekField current={player.currentTime} duration={player.duration} onSeek={player.seek} />
              <div className="ml-auto flex items-center gap-2">
                <Button variant="secondary" className="px-2 py-1.5 text-xs" onClick={addWholeVideo} title="Add full video">
                  <Plus className="mr-1 h-3.5 w-3.5" /> Clip
                </Button>
                <Button variant="secondary" className="px-2 py-1.5 text-xs" onClick={splitAtPlayhead} title="Split at playhead (S)">
                  <Scissors className="mr-1 h-3.5 w-3.5" /> Split
                </Button>
                <Button variant="secondary" className="px-2 py-1.5 text-xs" onClick={duplicateSelected} title="Duplicate (D)">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" className="px-2 py-1.5 text-red-300" onClick={deleteSelected} title="Delete (Del)">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <div className="mx-1 h-5 w-px bg-[var(--border)]" />
                <Button variant="ghost" className="px-2" onClick={zoomOut} title="Zoom out (-)">
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button variant="ghost" className="px-2" onClick={zoomIn} title="Zoom in (+)">
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </div>
            </Card>

            <Timeline
              clips={clips}
              source={project.source}
              currentTime={player.currentTime}
              selectedClipId={selectedClip?.id ?? null}
              pxPerSecond={pxPerSecond}
              waveform={waveform}
              onScrub={player.seek}
              onSelect={selectAndSeek}
              onTrimLive={onTrimLive}
              onTrimCommit={onTrimCommit}
              onReorder={reorder}
            />
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Shortcuts: Space play/pause · ←/→ step · Shift+←/→ second · S split · D duplicate · Del delete · Ctrl+Z/Ctrl+Shift+Z
              undo/redo · +/− zoom. All edits are non-destructive.
            </p>
          </div>

          {/* Right: properties */}
          <div>
            <Card className="xl:sticky xl:top-4">
              {selectedClip && framing ? (
                <>
                  <h2 className="mb-3 text-base font-semibold text-white">Clip properties</h2>
                  <PropertiesPanel
                    clip={selectedClip}
                    framing={framing}
                    aspectLabel={`${aspect.preset}`}
                    updateClip={updateSelected}
                    updateFraming={updateFraming}
                    applyLayout={applyLayout}
                  />
                </>
              ) : (
                <p className="text-sm text-[var(--muted-foreground)]">
                  Select a clip on the timeline to edit its trim, framing, audio, and layout.
                </p>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function SeekField({ current, duration, onSeek }: { current: number; duration: number; onSeek: (t: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  return (
    <div className="flex items-center gap-1 font-mono text-sm text-white">
      {editing ? (
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const parsed = parseTimecode(text);
            if (parsed !== null) onSeek(parsed);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-8 w-24 rounded-md border border-[var(--accent)] bg-[var(--surface-2)] px-2 text-sm outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setText(formatTimecode(current, true));
            setEditing(true);
          }}
          title="Click to enter an exact timestamp"
          className="rounded px-1 hover:bg-white/10"
        >
          {formatTimecode(current, true)}
        </button>
      )}
      <span className="text-[var(--muted-foreground)]">/ {formatTimecode(duration, true)}</span>
    </div>
  );
}
