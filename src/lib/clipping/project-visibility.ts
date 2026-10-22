import type { ClipProject } from "@/types/domain";

/** Deleted managed rows retain receipts on disk, but are never editor projects. */
export function isActiveClipProject(project: ClipProject): boolean {
  return !project.marketingEditor?.deletedAt;
}

export function activeClipProjects(projects: ClipProject[]): ClipProject[] {
  return projects.filter(isActiveClipProject);
}
