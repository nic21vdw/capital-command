"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Clapperboard, Film, Loader2, Plus, Trash2 } from "lucide-react";
import { useAppData } from "@/components/providers/app-provider";
import { chunkWords, windowSegments } from "@/lib/clipping/captions";
import { generateClipTitle, makeClipProject, makeTitleOverlay } from "@/lib/clipping/editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { ClipEditor } from "@/components/editor/clip-editor";
import { clearDraftProject, readDraftProject, writeDraftProject } from "@/components/editor/drafts";
import { EditorExportsProvider } from "@/components/editor/exports-provider";
import type { ClipProject } from "@/types/domain";
import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";

function formatDate(value?: string) {
  if (!value) return "Unknown date";
  return new Date(value).toLocaleString();
}

function sourceLabel(job: ClipJob | null, fallbackJobId: string) {
  return job?.fileName || `Job ${fallbackJobId}`;
}

function projectFromClip(job: ClipJob, clip: ClipCandidate, index: number, sourceFile = clip.file): ClipProject | null {
  if (!sourceFile) return null;
  const project = makeClipProject({
    jobId: job.id,
    name: `${job.fileName} — clip ${index + 1}`,
    sourceFile,
    posterFile: clip.posterFile,
    sourceUrl: job.sourceUrl,
    clipStart: clip.start,
    clipEnd: clip.end
  });
  const windowed = windowSegments(job.sourceCaptions ?? [], clip.start, clip.end);
  const words = windowed.flatMap((segment) => segment.words);
  project.captions = words.length ? chunkWords(words, project.captionStyle.maxWordsPerCaption) : windowed;
  project.title = generateClipTitle(project.captions, `Clip ${index + 1}`);
  if (project.title) project.name = project.title;
  project.overlays = [...project.overlays, makeTitleOverlay(project)];
  return project;
}

export function ClipEditorPage() {
  const { data, mutate, loading } = useAppData();
  const projects = data.clipProjects;
  const searchParams = useSearchParams();
  // Allow deep-linking straight into a project (e.g. from the Clip Generator).
  const [openId, setOpenId] = useState<string | null>(() => searchParams.get("open"));
  const sourceJobId = searchParams.get("job");
  const sourceFile = searchParams.get("file");
  const sourceClipIndex = searchParams.get("clip");
  const [picking, setPicking] = useState(false);
  const [jobs, setJobs] = useState<ClipJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [draftProject, setDraftProject] = useState<ClipProject | null>(null);
  const [filterJobId, setFilterJobId] = useState<string>("all");

  const storedProject = projects.find((p) => p.id === openId) ?? null;
  const draftForOpen = draftProject?.id === openId ? draftProject : null;
  // The store is the source of truth; the local draft only wins when it is
  // strictly newer (a save that never reached the server). While the app data
  // is still loading we never mount from a draft — an out-of-date draft would
  // shadow the saved project and the next autosave would overwrite real edits.
  const openProject =
    storedProject && draftForOpen
      ? draftForOpen.updatedAt > storedProject.updatedAt
        ? draftForOpen
        : storedProject
      : (storedProject ?? (loading ? null : draftForOpen));
  const jobsById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const renderableJobs = useMemo(
    () =>
      jobs
        .filter((job) => job.status === "done" && job.clips.some((clip) => clip.file))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [jobs]
  );
  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const jobA = jobsById.get(a.jobId);
        const jobB = jobsById.get(b.jobId);
        const sourceOrder = sourceLabel(jobA ?? null, a.jobId).localeCompare(sourceLabel(jobB ?? null, b.jobId));
        if (sourceOrder !== 0) return sourceOrder;
        const jobDateOrder = (jobB?.createdAt ?? "").localeCompare(jobA?.createdAt ?? "");
        if (jobDateOrder !== 0) return jobDateOrder;
        return b.updatedAt.localeCompare(a.updatedAt);
      }),
    [jobsById, projects]
  );
  // One option per source video that actually has projects, in the same
  // source-first order the grid uses.
  const sourceOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const project of sortedProjects) {
      if (!seen.has(project.jobId)) {
        seen.set(project.jobId, sourceLabel(jobsById.get(project.jobId) ?? null, project.jobId));
      }
    }
    return [...seen.entries()].map(([jobId, label]) => ({ jobId, label }));
  }, [jobsById, sortedProjects]);
  // A deleted project can leave the filter pointing at a source with no
  // projects left — fall back to showing everything instead of an empty grid.
  const activeFilter = sourceOptions.some((option) => option.jobId === filterJobId) ? filterJobId : "all";
  const visibleProjects = useMemo(
    () => (activeFilter === "all" ? sortedProjects : sortedProjects.filter((project) => project.jobId === activeFilter)),
    [activeFilter, sortedProjects]
  );

  // Always load the draft alongside the stored copy so the freshest of the
  // two can be picked above — never let one silently mask the other.
  useEffect(() => {
    if (!openId || typeof window === "undefined") return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setDraftProject(readDraftProject(openId));
    });
    return () => {
      cancelled = true;
    };
  }, [openId]);

  // Rebuilding a project from the job is only valid for the id the page was
  // deep-linked with: after switching clips inside the editor the job/file/clip
  // URL params still describe the original clip, and hydrating them into the
  // currently open project would overwrite it with the wrong clip's defaults.
  const deepLinkId = searchParams.get("open");
  useEffect(() => {
    if (!openId || openId !== deepLinkId || storedProject || draftProject || !sourceJobId || !sourceFile) return;
    let cancelled = false;
    const hydrateFromJob = async () => {
      const response = await fetch(`/api/clips/${sourceJobId}`, { cache: "no-store" });
      if (!response.ok || cancelled) return;
      const { job } = (await response.json()) as { job: ClipJob };
      const requestedIndex = sourceClipIndex ? Number(sourceClipIndex) : Number.NaN;
      const clipIndex = Number.isInteger(requestedIndex)
        ? requestedIndex
        : job.clips.findIndex((clip) => clip.file === sourceFile || clip.variants?.some((variant) => variant.file === sourceFile));
      const clip = job.clips[clipIndex];
      if (!clip) return;
      const project = projectFromClip(job, clip, clipIndex, sourceFile);
      if (!project || cancelled) return;
      project.id = openId;
      writeDraftProject(project);
      setDraftProject(project);
      void mutate("upsertClipProject", project);
    };
    void hydrateFromJob();
    return () => {
      cancelled = true;
    };
  }, [deepLinkId, draftProject, mutate, openId, sourceClipIndex, sourceFile, sourceJobId, storedProject]);

  const loadJobs = useCallback(async (showLoading = true) => {
    if (showLoading) setLoadingJobs(true);
    try {
      const res = await fetch("/api/clips", { cache: "no-store" });
      if (res.ok) {
        const { jobs: list } = (await res.json()) as { jobs: ClipJob[] };
        setJobs(list);
      }
    } finally {
      if (showLoading) setLoadingJobs(false);
    }
  }, []);

  const openPicker = () => {
    setPicking(true);
    void loadJobs();
  };

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadJobs(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadJobs]);

  const createFromClip = async (job: ClipJob, clip: ClipCandidate, index: number) => {
    const project = projectFromClip(job, clip, index);
    if (!project) return;
    writeDraftProject(project);
    await mutate("upsertClipProject", project, { successMessage: "Clip project created." });
    setPicking(false);
    setOpenId(project.id);
  };

  // Switching clips from the editor's clip bin: reuse an existing project for
  // that clip if there is one, otherwise start a fresh project.
  const switchToClip = (job: ClipJob, clip: ClipCandidate, index: number) => {
    // Duplicates can exist for one clip; resume the most recently edited one.
    const existing = projects
      .filter((p) => p.jobId === job.id && p.sourceFile === clip.file)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (existing) {
      setOpenId(existing.id);
      return;
    }
    void createFromClip(job, clip, index);
  };

  const deleteProject = async (project: ClipProject) => {
    clearDraftProject(project.id);
    await mutate("deleteClipProject", project.id, { successMessage: "Project deleted." });
    if (openId === project.id) setOpenId(null);
  };

  // A project was requested but the store is still loading (or a just-created
  // project hasn't landed yet) — hold instead of flashing the project list.
  if (!openProject && openId && loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading clip project…
      </div>
    );
  }

  const projectList = (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Creator Tools"
        title="Clip Editor"
        description="Open a clip to trim it on the timeline, pick a short-form layout, and export. Edits are non-destructive and saved automatically."
        actions={
          <div className="flex items-center gap-2">
            {sourceOptions.length > 1 ? (
              <Select
                value={activeFilter}
                onChange={(event) => setFilterJobId(event.target.value)}
                className="h-9 w-auto max-w-56"
                aria-label="Filter by source video"
              >
                <option value="all">All sources</option>
                {sourceOptions.map((option) => (
                  <option key={option.jobId} value={option.jobId}>
                    {option.label}
                  </option>
                ))}
              </Select>
            ) : null}
            <Button onClick={openPicker}>
              <Plus className="mr-2 h-4 w-4" />
              New project
            </Button>
          </div>
        }
      />

      {projects.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-14 text-center">
          <Clapperboard className="h-8 w-8 text-[var(--accent)]" />
          <p className="text-sm font-semibold text-white">No clip projects yet</p>
          <p className="max-w-md text-sm text-[var(--muted-foreground)]">
            Generate clips from a stream in the Clip Generator first, then open one here to trim, caption, and export it.
          </p>
          <Button onClick={openPicker} className="mt-1">
            <Plus className="mr-2 h-4 w-4" />
            New project
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((project) => (
            <Card key={project.id} className="animate-in space-y-3 transition-all duration-200 hover:border-[var(--border-strong)] hover:shadow-lg">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{project.name}</p>
                  <p className="truncate text-xs text-[var(--muted-foreground)]">
                    From {sourceLabel(jobsById.get(project.jobId) ?? null, project.jobId)}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {project.aspectRatio} · {project.captions.length} captions · {project.overlays.length} overlays
                  </p>
                </div>
                <button
                  type="button"
                  title="Delete project"
                  onClick={() => void deleteProject(project)}
                  className="text-[var(--muted-foreground)] transition hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <video
                src={`/api/clips/${project.jobId}/files/${encodeURIComponent(project.sourceFile)}`}
                poster={
                  project.posterFile
                    ? `/api/clips/${project.jobId}/files/${encodeURIComponent(project.posterFile)}`
                    : undefined
                }
                preload="metadata"
                muted
                className="aspect-video w-full rounded-lg bg-black object-contain ring-1 ring-white/10"
              />
              <div className="flex items-center justify-between">
                <Badge>{new Date(project.updatedAt).toLocaleDateString()}</Badge>
                <Button variant="secondary" className="px-3 py-1.5 text-sm" onClick={() => setOpenId(project.id)}>
                  Open editor
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={picking} title="New clip project" description="Pick a rendered clip to edit." onClose={() => setPicking(false)}>
        {loadingJobs ? (
          <div className="flex items-center gap-2 py-8 text-sm text-[var(--muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading rendered clips…
          </div>
        ) : renderableJobs.length === 0 ? (
          <div className="space-y-2 py-6 text-center">
            <Film className="mx-auto h-7 w-7 text-[var(--accent)]" />
            <p className="text-sm text-white">No rendered clips found.</p>
            <p className="text-sm text-[var(--muted-foreground)]">
              Use the Clip Generator to make clips from a stream first, then come back here.
            </p>
          </div>
        ) : (
          <div className="max-h-[68vh] space-y-3 overflow-y-auto">
            {renderableJobs.map((job) => (
              <div key={job.id} className="space-y-1.5">
                <p className="truncate text-sm font-medium text-white">{job.fileName}</p>
                <p className="truncate text-xs text-[var(--muted-foreground)]">
                  Job {job.id} - {formatDate(job.createdAt)} - {job.sourceUrl}
                </p>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
                  {job.clips
                    .filter((c) => c.file)
                    .map((clip, index) => (
                      <button
                        key={clip.id}
                        type="button"
                        onClick={() => void createFromClip(job, clip, index)}
                        className="rounded-lg border border-[var(--border)] p-1.5 text-left transition hover:border-[var(--accent)]"
                      >
                        <video
                          src={`/api/clips/${job.id}/files/${encodeURIComponent((clip.previewFile ?? clip.file) as string)}`}
                          poster={
                            clip.posterFile
                              ? `/api/clips/${job.id}/files/${encodeURIComponent(clip.posterFile)}`
                              : undefined
                          }
                          preload="metadata"
                          muted
                          playsInline
                          className="aspect-[9/16] w-full rounded bg-black object-cover"
                        />
                        <div className="mt-1 flex items-center justify-between gap-1">
                          <p className="truncate text-[11px] text-white">Clip {index + 1}</p>
                          <p className="shrink-0 text-[10px] text-[var(--muted-foreground)]">{Math.round(clip.end - clip.start)}s</p>
                        </div>
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );

  // A single provider wraps both views so background renders keep reporting
  // progress across clip switches and while the project list is showing.
  return (
    <EditorExportsProvider>
      {openProject ? (
        <ClipEditor
          key={openProject.id}
          initialProject={openProject}
          onClose={() => setOpenId(null)}
          onOpenClip={switchToClip}
        />
      ) : (
        projectList
      )}
    </EditorExportsProvider>
  );
}
