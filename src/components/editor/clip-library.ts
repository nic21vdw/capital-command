import { loadWorkflowJson } from "@/lib/marketing/workflow-resource";
import { clipProjectSchema } from "@/lib/storage/schemas";
import type { ClipJob } from "@/lib/clipping/types";
import type { ClipProject } from "@/types/domain";
import { isActiveClipProject } from "@/lib/clipping/project-visibility";

/** Recovery data can be opened, but only server data establishes a saved revision. */
export function selectClipProject(stored: ClipProject | null, draft: ClipProject | null, loading: boolean): {
  project: ClipProject | null; confirmed: boolean;
} {
  if (stored && !isActiveClipProject(stored)) return { project: null, confirmed: false };
  if (draft && !isActiveClipProject(draft)) draft = null;
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
  return (await readProjectDetail(id, signal, false))!;
}

async function readProjectDetail(id: string, signal: AbortSignal | undefined, allowMissing: boolean): Promise<ClipProject | null> {
  const timeout = AbortSignal.timeout(20_000);
  const response = await fetch(`/api/clip-projects/${encodeURIComponent(id)}`, {
    cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  });
  if (response.status === 410) throw new Error("This clip project was deleted. Return to the project library.");
  if (response.status === 404 && allowMissing) return null;
  if (!response.ok) throw new Error(`The server returned HTTP ${response.status}.`);
  const { project } = await response.json() as { project?: ClipProject };
  if (!project || project.id !== id || project.captionsOmitted || !Array.isArray(project.captions) || !isActiveClipProject(project)) {
    throw new Error("The server returned incomplete clip project data.");
  }
  const parsed = clipProjectSchema.safeParse(project);
  if (!parsed.success) throw new Error("The server returned incomplete clip project data.");
  return parsed.data;
}

/** Even a complete recovery draft must not reopen a server-side deletion. */
export async function loadClipProjectForEditor(project: ClipProject, signal?: AbortSignal): Promise<ClipProject> {
  if (!isActiveClipProject(project)) throw new Error("This clip project was deleted.");
  const stored = await readProjectDetail(project.id, signal, !project.marketingEditor && !project.captionsOmitted);
  return project.captionsOmitted ? stored! : project;
}
