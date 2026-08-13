import type { ClipProject } from "@/types/domain";

/**
 * The newest Clip Editor project per source file, worked out ONCE per store.
 *
 * A clip's project is found by job + the master file it was saved against, and
 * "newest wins" when a clip has been edited more than once. Answering that per
 * clip meant filtering and sorting the whole project store for every card on
 * screen; the store is one entry per edit, so it only ever grows.
 */

function indexKey(jobId: string, sourceFile: string): string {
  return `${jobId}\n${sourceFile}`;
}

export type ClipProjectIndex = Map<string, ClipProject>;

/** Job + source file → that clip's most recently updated project. */
export function indexProjectsBySource(projects: ClipProject[]): ClipProjectIndex {
  const index: ClipProjectIndex = new Map();
  for (const project of projects) {
    if (!project.sourceFile) continue;
    const key = indexKey(project.jobId, project.sourceFile);
    const current = index.get(key);
    if (!current || project.updatedAt.localeCompare(current.updatedAt) > 0) index.set(key, project);
  }
  return index;
}

export function newestProjectFor(
  index: ClipProjectIndex,
  jobId: string,
  sourceFile: string | undefined
): ClipProject | null {
  if (!sourceFile) return null;
  return index.get(indexKey(jobId, sourceFile)) ?? null;
}
