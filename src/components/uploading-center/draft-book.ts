import type { ClipDraft } from "@/components/uploading-center/use-uploading-center";

/**
 * The drafts (title, caption, target, slot) of every clip card, held where a
 * bulk action can read them straight after writing them.
 *
 * React state only shows a write on the NEXT render, and a bulk action
 * (Schedule N clips) writes a caption per clip, awaiting between them, then
 * plans the booking in the same tick as the last write. A ref refreshed from a
 * render effect was one render behind, so the last clip was planned from its
 * stale draft and booked with an empty caption and the default hashtag. The
 * book is updated synchronously and then hands the new map to React, so the
 * value read and the value shown can never disagree.
 */
export type DraftMap = Record<string, ClipDraft>;

export type DraftBook = {
  /** The latest drafts, including writes React has not rendered yet. */
  read: () => DraftMap;
  /** Replace the map with whatever `update` makes of the latest one. Returning the same object is a no-op for React. */
  update: (update: (current: DraftMap) => DraftMap) => void;
  /** Write one clip's draft. */
  put: (key: string, draft: ClipDraft) => void;
};

export function createDraftBook(publish: (next: DraftMap) => void, initial: DraftMap = {}): DraftBook {
  let current = initial;
  const update: DraftBook["update"] = (change) => {
    const next = change(current);
    if (next === current) return;
    current = next;
    publish(next);
  };
  return {
    read: () => current,
    update,
    put: (key, draft) => update((existing) => ({ ...existing, [key]: draft }))
  };
}
