import type { ClipProject } from "@/types/domain";

// Local snapshot of a clip project keyed by id. Drafts make deep links into
// the editor instant and act as a recovery copy when a server save fails —
// the store is still the source of truth (see openProject in clip-editor-page).
const EDITOR_DRAFT_PREFIX = "capital-command:clip-editor-draft:";

export function readDraftProject(id: string): ClipProject | null {
  if (typeof window === "undefined") return null;
  for (const storage of [sessionStorage, localStorage]) {
    const raw = storage.getItem(`${EDITOR_DRAFT_PREFIX}${id}`);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as ClipProject;
      return { ...parsed, compositionMode: parsed.compositionMode ?? "center-blur" };
    } catch {
      storage.removeItem(`${EDITOR_DRAFT_PREFIX}${id}`);
    }
  }
  return null;
}

export function writeDraftProject(project: ClipProject) {
  if (typeof window === "undefined") return;
  // A project from the app-data payload has no captions. Stored as a draft it
  // would look like a complete, newer copy, win over the saved project on the
  // next open (see openProject), and take the real captions down with it.
  if (project.captionsOmitted) return;
  const raw = JSON.stringify(project);
  for (const storage of [sessionStorage, localStorage]) {
    try {
      storage.setItem(`${EDITOR_DRAFT_PREFIX}${project.id}`, raw);
    } catch {
      // Quota exceeded (e.g. large embedded media) — drafts are best-effort.
    }
  }
}

export function clearDraftProject(id: string) {
  if (typeof window === "undefined") return;
  for (const storage of [sessionStorage, localStorage]) {
    storage.removeItem(`${EDITOR_DRAFT_PREFIX}${id}`);
  }
}
