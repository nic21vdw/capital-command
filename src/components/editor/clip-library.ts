import { loadWorkflowJson } from "@/lib/marketing/workflow-resource";
import { clipProjectSchema } from "@/lib/storage/schemas";
import type { ClipJob } from "@/lib/clipping/types";
import type { ClipProject } from "@/types/domain";

/** Recovery data can be opened, but only server data establishes a saved revision. */
export function selectClipProject(stored: ClipProject | null, draft: ClipProject | null, loading: boolean): {
  project: ClipProject | null; confirmed: boolean;
} {
  if (stored && (!draft || Date.parse(stored.updatedAt) >= Date.parse(draft.updatedAt))) {
    return { project: stored, confirmed: true };
  }
  return { project: loading ? null : draft, confirmed: false };
}

/** Every reopen requires its own detail response; live saves must not remount an active editor. */
export function clipProjectReadKey(project: ClipProject | null, generation: number, attempt: number): string {
  return JSON.stringify([project?.id ?? null, generation, attempt]);
}

export function currentClipProjectDetail<T extends { key: string }>(detail: T | null, key: string): T | null {
  return detail?.key === key ? detail : null;
}

/** Validate the fields the library renders before replacing its last useful copy. */
export async function loadClipLibrary(signal?: AbortSignal): Promise<ClipJob[]> {
  const { jobs } = await loadWorkflowJson<{ jobs: ClipJob[] }>("/api/clips", "jobs", signal);
  if (jobs.some((job) => !job || typeof job.id !== "string" || typeof job.fileName !== "string" ||
    typeof job.createdAt !== "string" || !["queued", "processing", "done", "error"].includes(job.status) ||
    !Array.isArray(job.clips) || job.clips.some((clip) => !clip || typeof clip.id !== "string" ||
      !Number.isFinite(clip.start) || !Number.isFinite(clip.end) ||
      (clip.file !== undefined && typeof clip.file !== "string")))) {
    throw new Error("The server returned incomplete clip library data.");
  }
  return jobs;
}

/** A summary or a different project's response must never enter the autosaving editor. */
export async function loadFullClipProject(id: string, signal?: AbortSignal): Promise<ClipProject> {
  const { project } = await loadWorkflowJson<{ project?: ClipProject }>(
    `/api/clip-projects/${encodeURIComponent(id)}`, undefined, signal
  );
  if (!project || project.id !== id || project.captionsOmitted || !Array.isArray(project.captions)) {
    throw new Error("The server returned incomplete clip project data.");
  }
  const parsed = clipProjectSchema.safeParse(project);
  if (!parsed.success) throw new Error("The server returned incomplete clip project data.");
  return parsed.data;
}
