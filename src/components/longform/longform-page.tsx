"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Clapperboard, Film, Layers, Loader2, MonitorCheck, Music4, Scissors, Trash2, UploadCloud, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { AdvancedOptions } from "@/components/ui/advanced-options";
import { LongformEditor } from "@/components/longform/longform-editor";
import { formatClock } from "@/lib/clipping/editor";
import type { LongformProjectSummary } from "@/lib/longform/summary";
import type { LongformProject } from "@/lib/longform/types";
import { cn } from "@/lib/utils";

// The Long-Form Editor home: drop in a raw recording and it comes back with a
// viral hook plan, the dead space cut out, and a timeline to fine-tune —
// then exports straight into the Clip Generator.

const STAGE_LABELS: Record<LongformProject["stage"], string> = {
  downloading: "Downloading the video",
  probing: "Reading the video",
  transcribing: "Transcribing your words",
  analyzing: "Finding dead space",
  planning: "Planning the hook & cuts",
  ready: "Ready"
};

/** How many of a project's topic segments already have a finished video. */
function renderedSegments(project: LongformProjectSummary): number {
  return (project.topics ?? []).filter((topic) =>
    project.exports.some((item) => item.topicId === topic.id && item.status === "done" && item.file)
  ).length;
}

function ProjectPoster({ project }: { project: LongformProjectSummary }) {
  const [failed, setFailed] = useState(false);
  if (failed || project.status !== "ready") return null;
  const generated = project.exports.some((item) => item.thumbnailFile);
  return (
    <div className="relative -mx-4 -mt-4 aspect-video overflow-hidden border-b border-[var(--border)] bg-black/40">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/longform/projects/${project.id}/poster`}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
      <span
        className={cn(
          "absolute left-2 top-2 rounded border bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide backdrop-blur",
          generated ? "border-[var(--accent)]/50 text-[var(--accent)]" : "border-white/15 text-white/70"
        )}
      >
        {generated ? "Thumbnail" : "Auto frame"}
      </span>
    </div>
  );
}

export function LongformStudioPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openId = searchParams.get("open");
  // Which topic segment of that project the editor should open on.
  const openSegmentId = searchParams.get("segment");

  const [projects, setProjects] = useState<LongformProjectSummary[]>([]);
  // The full project behind `openId`. The list carries summaries — a project's
  // transcript, silences, segment plan and captions are almost all of its
  // weight — so the one being edited is fetched whole on its own.
  const [openProject, setOpenProject] = useState<LongformProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  // Which card has its segment list unfolded.
  const [segmentsOpen, setSegmentsOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/longform/projects", { cache: "no-store" });
      if (!response.ok) return;
      const { projects: list } = (await response.json()) as { projects: LongformProjectSummary[] };
      setProjects(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  // Poll while anything is analyzing so progress cards move on their own.
  const anyProcessing = projects.some((project) => project.status === "processing");
  useEffect(() => {
    if (!anyProcessing) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [anyProcessing, refresh]);

  // Only a ready project opens in the editor, so wait for the summary to say so
  // before pulling the whole thing down. A project loaded for a previous
  // `openId` is left where it is — the editor below only renders the one whose
  // id matches, so it is never shown.
  const openIsReady = projects.some((project) => project.id === openId && project.status === "ready");
  useEffect(() => {
    if (!openId || !openIsReady) return;
    let cancelled = false;
    void fetch(`/api/longform/projects/${encodeURIComponent(openId)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { project?: LongformProject } | null) => {
        if (!cancelled && data?.project) setOpenProject(data.project);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [openId, openIsReady]);

  const setOpen = useCallback(
    (id: string | null, segmentId?: string) => {
      if (!id) {
        router.replace("/longform");
        return;
      }
      const segment = segmentId ? `&segment=${encodeURIComponent(segmentId)}` : "";
      router.replace(`/longform?open=${encodeURIComponent(id)}${segment}`);
    },
    [router]
  );

  /**
   * Uploads with XHR instead of fetch so multi-GB recordings get a real
   * progress bar, then starts the analysis pipeline on the new source.
   */
  const uploadFile = useCallback(
    (file: File) => {
      setUploadPct(0);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/clips/sources?name=${encodeURIComponent(file.name)}`);
      xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) setUploadPct(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onerror = () => {
        setUploadPct(null);
        toast.error("Upload failed. Is the dev server still running?");
      };
      xhr.onload = async () => {
        setUploadPct(null);
        let source: { id: string } | undefined;
        try {
          const data = JSON.parse(xhr.responseText) as { source?: { id: string }; error?: string };
          if (xhr.status < 300) source = data.source;
          else toast.error(data.error ?? "Upload failed.");
        } catch {
          toast.error("Upload failed.");
        }
        if (!source) return;
        setCreating(true);
        try {
          const response = await fetch("/api/longform/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceId: source.id, name: file.name })
          });
          const data = (await response.json()) as { project?: LongformProject; error?: string };
          if (!response.ok || !data.project) {
            toast.error(data.error ?? "Could not start analyzing that video.");
            return;
          }
          toast.success("Upload complete — analyzing your video now.");
          await refresh();
          setOpen(data.project.id);
        } catch {
          toast.error("Could not start analyzing that video.");
        } finally {
          setCreating(false);
        }
      };
      xhr.send(file);
    },
    [refresh, setOpen]
  );

  const acceptFile = useCallback(
    (files: FileList | null) => {
      const file = files
        ? Array.from(files).find(
            (item) => item.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(item.name)
          )
        : undefined;
      if (!file) {
        toast.error("Drop a video file (mp4, mov, mkv, webm…).");
        return;
      }
      uploadFile(file);
    },
    [uploadFile]
  );

  // Import straight from a YouTube (or other VOD) link: the server downloads
  // the full video, then runs the same analysis an upload gets.
  const importUrl = useCallback(async () => {
    const trimmed = url.trim();
    if (!/^https?:\/\/\S+$/i.test(trimmed)) {
      toast.error("Paste a full YouTube or VOD link starting with http:// or https://.");
      return;
    }
    setImporting(true);
    try {
      const response = await fetch("/api/longform/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed })
      });
      const data = (await response.json()) as { project?: LongformProject; error?: string };
      if (!response.ok || !data.project) {
        toast.error(data.error ?? "Could not start downloading that video.");
        return;
      }
      setUrl("");
      toast.success("Downloading your video — analysis starts automatically.");
      await refresh();
      setOpen(data.project.id);
    } catch {
      toast.error("Could not start downloading that video.");
    } finally {
      setImporting(false);
    }
  }, [url, refresh, setOpen]);

  const startRename = useCallback((project: LongformProjectSummary) => {
    setEditingId(project.id);
    setDraftName(project.name);
  }, []);

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setDraftName("");
  }, []);

  const commitRename = useCallback(
    async (project: LongformProjectSummary) => {
      const name = draftName.trim();
      setEditingId(null);
      setDraftName("");
      if (!name || name === project.name) return;
      // Optimistically show the new title while the save lands.
      setProjects((prev) => prev.map((item) => (item.id === project.id ? { ...item, name } : item)));
      try {
        const response = await fetch(`/api/longform/projects/${project.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name })
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          toast.error(data.error ?? "Could not rename this project.");
          await refresh();
        }
      } catch {
        toast.error("Could not rename this project.");
        await refresh();
      }
    },
    [draftName, refresh]
  );

  const deleteProject = useCallback(
    async (project: LongformProjectSummary) => {
      if (!window.confirm(`Delete “${project.name}”? Its exports are removed too.`)) return;
      const response = await fetch(`/api/longform/projects/${project.id}`, { method: "DELETE" });
      if (response.ok) {
        toast.success("Project deleted.");
        await refresh();
      } else {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Could not delete this project.");
      }
    },
    [refresh]
  );

  // Editor view for a ready project.
  if (openProject && openProject.id === openId && openProject.status === "ready") {
    return (
      <LongformEditor
        key={openProject.id}
        initialProject={openProject}
        initialSegmentId={openSegmentId}
        onClose={() => {
          setOpen(null);
          void refresh();
        }}
        onDeleted={() => {
          setOpen(null);
          void refresh();
        }}
      />
    );
  }

  const busy = uploadPct !== null || creating || importing;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Step 2 · Formats"
        title="Long-Form Video"
        description="Turn a raw recording into a finished long-form upload."
      />

      {/* Analyzing state for the opened project */}
      {openProject && openProject.status !== "ready" && (
        <Card className="animate-in space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-white">{openProject.name}</h2>
              <p className="text-sm text-[var(--muted-foreground)]">
                {openProject.status === "error"
                  ? (openProject.error ?? "Something went wrong analyzing this video.")
                  : `${STAGE_LABELS[openProject.stage]}… this runs fully on your machine.`}
              </p>
            </div>
            <Badge>{openProject.status === "error" ? "Error" : `${openProject.progress}%`}</Badge>
          </div>
          {openProject.status === "processing" && <Progress value={openProject.progress} />}
          <div className="flex gap-2">
            {openProject.status === "error" && (
              <Button
                variant="secondary"
                onClick={async () => {
                  const response = await fetch(`/api/longform/projects/${openProject.id}`, { method: "POST" });
                  if (response.ok) void refresh();
                  else toast.error("Could not retry the analysis.");
                }}
              >
                Retry analysis
              </Button>
            )}
            <Button variant="ghost" onClick={() => setOpen(null)}>
              Back to projects
            </Button>
          </div>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        {/* Upload */}
        <div className="space-y-4">
          <Card>
            <h2 className="text-base font-semibold text-white">Add a recording</h2>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(event) => {
                acceptFile(event.target.files);
                event.target.value = "";
              }}
            />
            <div
              role="button"
              tabIndex={0}
              onClick={() => !busy && fileRef.current?.click()}
              onKeyDown={(event) => {
                if ((event.key === "Enter" || event.key === " ") && !busy) fileRef.current?.click();
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
                if (!busy) acceptFile(event.dataTransfer.files);
              }}
              className={cn(
                "mt-4 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition",
                dragging
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border)] hover:border-[var(--border-strong)]",
                busy && "pointer-events-none opacity-70"
              )}
            >
              {busy ? (
                <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
              ) : (
                <UploadCloud className="h-8 w-8 text-[var(--accent)]" />
              )}
              <div>
                <p className="text-sm font-medium text-white">
                  {uploadPct !== null
                    ? `Uploading… ${uploadPct}%`
                    : creating
                      ? "Starting analysis…"
                      : "Drop your video here or click to browse"}
                </p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">MP4, MOV, MKV, WEBM — hours-long files are fine</p>
              </div>
              {uploadPct !== null && <Progress value={uploadPct} className="w-full" />}
            </div>

            <AdvancedOptions
              id="longform-source"
              label="Import from a link"
              summary={url.trim() ? `Link ready: ${url.trim()}` : "Or paste a YouTube / VOD link"}
              className="mt-4"
            >
              <div className="flex gap-2">
                <input
                  type="url"
                  inputMode="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !busy) void importUrl();
                  }}
                  placeholder="https://youtube.com/watch?v=..."
                  disabled={busy}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm text-white outline-none transition placeholder:text-[var(--muted-foreground)] focus:border-[var(--accent)] disabled:opacity-60"
                  aria-label="YouTube or VOD link"
                />
                <Button onClick={() => void importUrl()} disabled={busy || !url.trim()} className="shrink-0">
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Import"}
                </Button>
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                We pull down the full recording and analyze it exactly like an upload.
              </p>
            </AdvancedOptions>
          </Card>

          <AdvancedOptions
            id="longform-explainer"
            label="What it does"
            summary="Viral hook, dead air cut, music, into the Clip Generator"
          >
            <ul className="space-y-3 text-sm text-[var(--muted-foreground)]">
              <li className="flex gap-3">
                <Zap className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                <span>
                  <span className="text-white">Viral hook</span> — punches in on your face for the first 5–10 seconds
                  with big word-synced captions.
                </span>
              </li>
              <li className="flex gap-3">
                <Scissors className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                <span>
                  <span className="text-white">Auto cuts</span> — every pause with no talking is trimmed so the video
                  stays fast-paced.
                </span>
              </li>
              <li className="flex gap-3">
                <Music4 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                <span>
                  <span className="text-white">Background music</span> — upload songs once, mix them under any video.
                </span>
              </li>
              <li className="flex gap-3">
                <Film className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                <span>
                  <span className="text-white">All-in-one</span> — export lands straight in the Clip Generator, ready
                  to become shorts.
                </span>
              </li>
              {/* Shortening the upload blurb deleted the only place that said
                  the recording never leaves the machine. That is a promise
                  about his footage, not filler. */}
              <li className="flex gap-3">
                <MonitorCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                <span>
                  <span className="text-white">Stays on this computer</span> — transcription, silence detection and
                  hook planning all run locally.
                </span>
              </li>
            </ul>
          </AdvancedOptions>
        </div>

        {/* Project list */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-white">Your videos</h2>
          {loading && <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>}
          {!loading && projects.length === 0 && (
            <Card className="flex flex-col items-center gap-2 py-12 text-center">
              <Clapperboard className="h-8 w-8 text-[var(--muted-foreground)]" />
              <p className="text-sm text-[var(--muted-foreground)]">
                No projects yet — upload your first recording to see the magic.
              </p>
            </Card>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {projects.map((project) => {
              const editedSec = project.editedDurationSec;
              return (
                <Card key={project.id} className="animate-in flex flex-col gap-3 overflow-hidden p-4">
                  <ProjectPoster project={project} />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {editingId === project.id ? (
                        <input
                          autoFocus
                          value={draftName}
                          onChange={(event) => setDraftName(event.target.value)}
                          onBlur={() => void commitRename(project)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void commitRename(project);
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              cancelRename();
                            }
                          }}
                          maxLength={200}
                          className="w-full rounded border border-[var(--accent)] bg-transparent px-1 py-0.5 text-sm font-semibold text-white outline-none"
                          aria-label="Video title"
                        />
                      ) : (
                        <h3
                          className="cursor-text truncate text-sm font-semibold text-white"
                          onDoubleClick={() => startRename(project)}
                          title="Double-click to rename"
                        >
                          {project.name}
                        </h3>
                      )}
                      {/* Same "From <source>" line the Clip Editor's cards carry: a
                          project is renamed freely, so the recording it was cut from
                          is the only thing that says where it came from. */}
                      {project.fileName && (
                        <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
                          From {project.fileName}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                        {formatClock(project.durationSec)}
                        {editedSec !== null && (
                          <>
                            {" "}
                            → <span className="text-white">{formatClock(editedSec)}</span> edited
                          </>
                        )}
                        {project.topics && project.topics.length > 0 && (
                          <>
                            {" · "}
                            <span className="text-white">{project.topics.length}</span> segment
                            {project.topics.length === 1 ? "" : "s"}
                          </>
                        )}
                      </p>
                    </div>
                    <Badge
                      className={cn(
                        project.status === "ready" && "border-emerald-400/40 text-emerald-400",
                        project.status === "error" && "border-red-400/40 text-red-400"
                      )}
                    >
                      {project.status === "processing"
                        ? `${project.progress}%`
                        : project.status === "ready"
                          ? "Ready"
                          : "Error"}
                    </Badge>
                  </div>
                  {project.status === "processing" && (
                    <div className="space-y-1">
                      <Progress value={project.progress} />
                      <p className="text-xs text-[var(--muted-foreground)]">{STAGE_LABELS[project.stage]}…</p>
                    </div>
                  )}
                  {project.status === "error" && (
                    <p className="line-clamp-2 text-xs text-red-300">{project.error}</p>
                  )}
                  {/* A weak opening is the one problem that never announces
                      itself: the export succeeds and the video simply does not
                      hold anyone. Say so on the card, before it ships. */}
                  {project.status === "ready" && project.hookReview?.verdict === "weak" && (
                    <button
                      type="button"
                      onClick={() => setOpen(project.id)}
                      className="flex items-start gap-2 rounded-lg border border-amber-400/50 bg-amber-400/5 px-2.5 py-2 text-left text-xs text-amber-200 transition hover:bg-amber-400/10"
                    >
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0">
                        Weak opening ({project.hookReview.score}/100) — the first 30 seconds need a real hook.
                      </span>
                    </button>
                  )}
                  {/* A stream is several videos in one recording. The card lists
                      them so the segment you want is one click away, instead of
                      opening the whole stream and hunting for it. */}
                  {project.topics && project.topics.length > 0 && (
                    <div className="rounded-lg border border-[var(--border)]">
                      <button
                        type="button"
                        onClick={() => setSegmentsOpen((current) => (current === project.id ? null : project.id))}
                        aria-expanded={segmentsOpen === project.id}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--muted-foreground)] transition hover:text-white"
                      >
                        <Layers className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                        <span className="flex-1 truncate">
                          {project.topics.length} long-form segment{project.topics.length === 1 ? "" : "s"} ·{" "}
                          {renderedSegments(project)} rendered
                        </span>
                        <ChevronDown
                          className={cn("h-3.5 w-3.5 shrink-0 transition", segmentsOpen === project.id && "rotate-180")}
                        />
                      </button>
                      {segmentsOpen === project.id && (
                        <div className="space-y-1 border-t border-[var(--border)] p-1">
                          {project.topics.map((topic, index) => {
                            const record = project.exports.find((item) => item.topicId === topic.id);
                            const rendered = record?.status === "done" && Boolean(record.file);
                            return (
                              <button
                                key={topic.id}
                                type="button"
                                onClick={() => setOpen(project.id, topic.id)}
                                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-white/5"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs text-white">
                                    {index + 1}. {topic.title}
                                  </span>
                                  <span className="block truncate text-[10px] tabular-nums text-[var(--muted-foreground)]">
                                    {formatClock(Math.max(0, topic.end - topic.start))} ·{" "}
                                    {record?.status === "processing"
                                      ? `rendering ${record.progress}%`
                                      : rendered
                                        ? "rendered"
                                        : "not rendered yet"}
                                  </span>
                                </span>
                                {rendered && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="mt-auto flex items-center gap-2">
                    <Button
                      className="flex-1"
                      variant={project.status === "ready" ? "primary" : "secondary"}
                      onClick={() => setOpen(project.id)}
                    >
                      {project.status === "ready" ? "Open editor" : "View progress"}
                    </Button>
                    <button
                      type="button"
                      onClick={() => void deleteProject(project)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] transition hover:border-red-400/60 hover:text-red-400"
                      aria-label="Delete project"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
