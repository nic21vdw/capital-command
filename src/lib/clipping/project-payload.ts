import { renderSignature } from "@/lib/clipping/export-signature";
import { writeAppData } from "@/lib/storage/store";
import type { AppData, ClipProject } from "@/types/domain";

/**
 * A clip project's `captions` are word-level and about 8.4 KB each; across the
 * library they were 1.2 MB — half of everything the browser downloaded on every
 * page of the app, for a field only the ONE project open in the editor reads.
 *
 * They cannot simply be re-derived on demand: captions start out as the job's
 * transcript windowed to the clip, but the editor can split, merge and re-time
 * them by hand, and those edits exist nowhere else. So the stored project keeps
 * them and only the LIST payload drops them.
 *
 * What the list still needs is the render signature, and that hashes the
 * captions — which is why it is computed once on write and stored, rather than
 * recomputed in the browser from data the browser no longer has.
 */

/** The signature the Uploading Center compares against a clip's `editedSignature`. */
export function projectSignature(project: ClipProject): string {
  return renderSignature({ ...project, settings: project.exportSettings });
}

/** A project with its derived fields brought up to date. */
export function stampProjectSignature(project: ClipProject): ClipProject {
  const signature = projectSignature(project);
  const captionCount = project.captions?.length ?? 0;
  if (project.renderSignature === signature && project.captionCount === captionCount) return project;
  return { ...project, renderSignature: signature, captionCount };
}

/**
 * Brings every project's stamp up to date and persists it when anything moved.
 * The read routes call this so a library saved before the field existed fills
 * itself in on the first request — the same "nothing to press" repair the
 * overlay pictures get.
 */
export async function stampAppDataSignatures(data: AppData): Promise<AppData> {
  const projects = data.clipProjects ?? [];
  let changed = false;
  const stamped = projects.map((project) => {
    const next = stampProjectSignature(project);
    if (next !== project) changed = true;
    return next;
  });
  if (!changed) return data;

  const repaired = { ...data, clipProjects: stamped };
  await writeAppData(repaired);
  return repaired;
}

/**
 * The project as a list should carry it: everything except the captions, and
 * flagged so nothing saves this copy back over the real one.
 */
export function projectWithoutCaptions(project: ClipProject): ClipProject {
  return {
    ...stampProjectSignature(project),
    captions: [],
    captionsOmitted: true
  };
}

export function projectsWithoutCaptions(projects: ClipProject[]): ClipProject[] {
  return projects.map(projectWithoutCaptions);
}
