import { writeDraftProject } from "./drafts";
import type { ClipProject } from "@/types/domain";

type SaveMutation = (action: string, payload: ClipProject, options: { rethrow: true; signal: AbortSignal }) => Promise<void>;

/** Serialize saves so an older request cannot overwrite a newer successful edit. */
export class ClipProjectPersistence {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly mutate: SaveMutation) {}

  save(project: ClipProject, isCurrent: () => boolean): Promise<boolean> {
    const snapshot = { ...project, updatedAt: new Date().toISOString() };
    writeDraftProject(snapshot);
    const attempt = this.pending.catch(() => undefined).then(async () => {
      // A newer revision waiting behind the current request makes this one obsolete.
      if (!isCurrent()) return false;
      await this.mutate("upsertClipProject", snapshot, { rethrow: true, signal: AbortSignal.timeout(20_000) });
      return isCurrent();
    });
    this.pending = attempt;
    return attempt;
  }
}

/** Leaving or scheduling requires the current edit to have a confirmed save. */
export async function afterConfirmedSave(save: () => Promise<boolean>, next: () => void): Promise<void> {
  if (await save()) next();
}
