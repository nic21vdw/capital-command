import type { ClipProject } from "@/types/domain";
import { clipProjectSchema } from "@/lib/storage/schemas";
import { browserStorage } from "./browser-storage";

// Local snapshot of a clip project keyed by id. Drafts make deep links into
// the editor instant and act as a recovery copy when a server save fails —
// the store is still the source of truth (see openProject in clip-editor-page).
const EDITOR_DRAFT_PREFIX = "capital-command:clip-editor-draft:";

export function readDraftProject(id: string): ClipProject | null {
  let newest: ClipProject | null = null;
  for (const area of ["sessionStorage", "localStorage"] as const) {
    const storage = browserStorage(area);
    if (!storage) continue;
    try {
      const raw = storage.getItem(`${EDITOR_DRAFT_PREFIX}${id}`);
      if (!raw) continue;
      const value = JSON.parse(raw);
      // A list payload is not a recovery copy: defaulting absent captions to
      // [] here would let a newer but incomplete draft erase the real edits.
      if (!value || value.id !== id || value.captionsOmitted || !Array.isArray(value.captions)) continue;
      const parsed = clipProjectSchema.safeParse(value);
      if (!parsed.success || !Number.isFinite(Date.parse(parsed.data.updatedAt))) continue;
      if (!newest || Date.parse(parsed.data.updatedAt) > Date.parse(newest.updatedAt)) newest = parsed.data;
    } catch {
      // Unavailable or malformed storage must not block the other recovery copy.
    }
  }
  return newest;
}

export function writeDraftProject(project: ClipProject) {
  if (typeof window === "undefined") return;
  // A project from the app-data payload has no captions. Stored as a draft it
  // would look like a complete, newer copy, win over the saved project on the
  // next open (see openProject), and take the real captions down with it.
  if (project.captionsOmitted) return;
  const raw = JSON.stringify(project);
  for (const area of ["sessionStorage", "localStorage"] as const) {
    try {
      browserStorage(area)?.setItem(`${EDITOR_DRAFT_PREFIX}${project.id}`, raw);
    } catch {
      // Quota exceeded (e.g. large embedded media) — drafts are best-effort.
    }
  }
}

export function clearDraftProject(id: string) {
  if (typeof window === "undefined") return;
  for (const area of ["sessionStorage", "localStorage"] as const) {
    try {
      browserStorage(area)?.removeItem(`${EDITOR_DRAFT_PREFIX}${id}`);
    } catch {
      // Clearing one unavailable cache must not prevent clearing the other.
    }
  }
}
