"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Clapperboard, Film, Loader2, Plus, Trash2 } from "lucide-react";
import { useAppData } from "@/components/providers/app-provider";
import { chunkWords, windowSegments } from "@/lib/clipping/captions";
import { generateClipTitle, makeClipProject } from "@/lib/clipping/editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { ClipEditor } from "@/components/editor/clip-editor";
import type { ClipProject } from "@/types/domain";
import type { ClipCandidate, ClipJob } from "@/lib/clipping/types";

const EDITOR_DRAFT_PREFIX = "capital-command:clip-editor-draft:";

function readDraftProject(openId: string): ClipProject | null {
  if (typeof window === "undefined") return null;
  for (const storage of [sessionStorage, localStorage]) {
    const raw = storage.getItem(`${EDITOR_DRAFT_PREFIX}${openId}`);
    if (!raw) continue;
    try {
      return JSON.parse(raw) as ClipProject;
    } catch {
      storage.removeItem(`${EDITOR_DRAFT_PREFIX}${openId}`);
    }
  }
  return null;
}

function writeDraftProject(project: ClipProject) {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(project);
  sessionStorage.setItem(`${EDITOR_DRAFT_PREFIX}${project.id}`, raw);
  localStorage.setItem(`${EDITOR_DRAFT_PREFIX}${project.id}`, raw);
}

function projectFromClip(job: ClipJob, clip: ClipCandidate, index: number, sourceFile = clip.file): ClipProject | null {
  if (!sourceFile) return null;
  const project = makeClipProject({
    jobId: job.id,
    name: `${job.fileName} — clip ${index + 1}`,
    sourceFile,
    sourceUrl: job.sourceUrl,
    clipStart: clip.start,
    clipEnd: clip.end
  });
  const windowed = windowSegments(job.sourceCaptions ?? [], clip.start, clip.end);
  const words = windowed.flatMap((segment) => segment.words);
  project.captions = words.length ? chunkWords(words, project.captionStyle.maxWordsPerCaption) : windowed;
  project.title = generateClipTitle(project.captions, `Clip ${index + 1}`);
  if (project.title) project.name = project.title;
  project.suggestions = [
    {
      id: `sug-${crypto.randomUUID().slice(0, 8)}`,
      start: 0,
      end: project.baseDurationSec,
      score: clip.score,
      rationale: clip.rationale,
      status: "pending",
      addedToTimeline: false
    }
  ];
  return project;
}

export function ClipEditorPage() {
  const { data, mutate } = useAppData();
  const projects = data.clipProjects;
  const searchParams = useSearchParams();
  // Allow deep-linking straight into a project (e.g. from the Clipping Agent).
  const [openId, setOpenId] = useState<string | null>(() => searchParams.get("open"));
  const sourceJobId = searchParams.get("job");
  const sourceFile = searchParams.get("file");
  const sourceClipIndex = searchParams.get("clip");
  const [picking, setPicking] = useState(false);
  const [jobs, setJobs] = useState<ClipJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [draftProject, setDraftProject] = useState<ClipProject | null>(null);

  const storedProject = projects.find((p) => p.id === openId) ?? null;
  const openProject = storedProject ?? (draftProject?.id === openId ? draftProject : null);

  useEffect(() => {
    if (!openId || storedProject || typeof window === "undefined") {
      if (storedProject) queueMicrotask(() => setDraftProject(null));
      return;
    }
    const parsed = readDraftProject(openId);
    if (parsed) queueMicrotask(() => setDraftProject(parsed));
  }, [openId, storedProject]);

  useEffect(() => {
    if (!openId || storedProject || draftProject || !sourceJobId || !sourceFile) return;
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
  }, [draftProject, mutate, openId, sourceClipIndex, sourceFile, sourceJobId, storedProject]);

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const res = await fetch("/api/clips", { cache: "no-store" });
      if (res.ok) {
        const { jobs: list } = (await res.json()) as { jobs: ClipJob[] };
        setJobs(list.filter((j) => j.status === "done" && j.clips.some((c) => c.file)));
      }
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  const openPicker = () => {
    setPicking(true);
    void loadJobs();
  };

  const createFromClip = async (job: ClipJob, clip: ClipCandidate, index: number) => {
    const project = projectFromClip(job, clip, index);
    if (!project) return;
    writeDraftProject(project);
    await mutate("upsertClipProject", project, { successMessage: "Clip project created." });
    setPicking(false);
    setOpenId(project.id);
  };

  const deleteProject = async (project: ClipProject) => {
    await mutate("deleteClipProject", project.id, { successMessage: "Project deleted." });
    if (openId === project.id) setOpenId(null);
  };

  if (openProject) {
    return <ClipEditor key={openProject.id} initialProject={openProject} onClose={() => setOpenId(null)} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Creator Tools"
        title="Clip Editor"
        description="Open a rendered clip to add captions, overlays, reframing, and audio, then export a finished video. Edits are non-destructive and saved automatically."
        actions={
          <Button onClick={openPicker}>
            <Plus className="mr-2 h-4 w-4" />
            New project
          </Button>
        }
      />

      {projects.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-14 text-center">
          <Clapperboard className="h-8 w-8 text-[var(--accent)]" />
          <p className="text-sm font-semibold text-white">No clip projects yet</p>
          <p className="max-w-md text-sm text-[var(--muted-foreground)]">
            Render some clips in the Clipping Agent first, then start a project here to caption, brand, and export them.
          </p>
          <Button onClick={openPicker} className="mt-1">
            <Plus className="mr-2 h-4 w-4" />
            New project
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <Card key={project.id} className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{project.name}</p>
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
        ) : jobs.length === 0 ? (
          <div className="space-y-2 py-6 text-center">
            <Film className="mx-auto h-7 w-7 text-[var(--accent)]" />
            <p className="text-sm text-white">No rendered clips found.</p>
            <p className="text-sm text-[var(--muted-foreground)]">
              Use the Clipping Agent to render clips from a VOD link first, then come back here.
            </p>
          </div>
        ) : (
          <div className="max-h-[68vh] space-y-3 overflow-y-auto">
            {jobs.map((job) => (
              <div key={job.id} className="space-y-1.5">
                <p className="truncate text-sm font-medium text-white">{job.fileName}</p>
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
                          src={`/api/clips/${job.id}/files/${encodeURIComponent(clip.file as string)}`}
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
}
