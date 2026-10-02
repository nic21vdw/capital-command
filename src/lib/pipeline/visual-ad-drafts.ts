import type { VisualAdSettings } from "@/lib/pipeline/visual-ad-render";

export type VisualAdSource = {
  src: string;
  width: number;
  height: number;
  origin: "stream-frame" | "upload" | "retouched-import";
  name: string;
  capturedAt: string;
  sourceTime?: number;
};

export type StoredVisualAdDraft = {
  id: string;
  updatedAt: number;
  settings: VisualAdSettings;
  original: VisualAdSource;
  retouched: VisualAdSource | null;
  useRetouched: boolean;
  identityReviewed: boolean;
};

export const MAX_VISUAL_AD_DRAFTS = 6;
export const MAX_VISUAL_AD_DRAFT_BYTES = 48 * 1024 * 1024;

export function visualAdDraftId(
  sourceId: string | undefined,
  streamName: string,
  start: number,
) {
  return JSON.stringify([sourceId ?? streamName, start]);
}

export function visualAdDraftBytes(draft: StoredVisualAdDraft) {
  return (
    (draft.original.src.length + (draft.retouched?.src.length ?? 0)) * 2 +
    JSON.stringify(draft.settings).length * 2 +
    2048
  );
}

export function visualAdDraftsToRemove(
  drafts: StoredVisualAdDraft[],
  keepId: string,
) {
  const ranked = [...drafts].sort(
    (a, b) =>
      Number(b.id === keepId) - Number(a.id === keepId) ||
      b.updatedAt - a.updatedAt,
  );
  const remove: string[] = [];
  let count = 0;
  let bytes = 0;
  for (const draft of ranked) {
    const size = visualAdDraftBytes(draft);
    if (
      count >= MAX_VISUAL_AD_DRAFTS ||
      bytes + size > MAX_VISUAL_AD_DRAFT_BYTES
    )
      remove.push(draft.id);
    else {
      count++;
      bytes += size;
    }
  }
  return remove;
}

function openDraftDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(
        new Error(
          "Draft storage is unavailable in this browser. Download your draft before leaving.",
        ),
      );
      return;
    }
    const request = indexedDB.open("capital-command-visual-ads", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("drafts", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open local draft storage."));
    request.onblocked = () =>
      reject(
        new Error(
          "Local draft storage is blocked. Close other old ad tabs and download this draft.",
        ),
      );
  });
}

export async function loadVisualAdDraft(
  id: string,
): Promise<StoredVisualAdDraft | null> {
  const database = await openDraftDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("drafts", "readonly");
      const request = transaction.objectStore("drafts").get(id);
      request.onsuccess = () =>
        resolve(
          request.result?.id === id
            ? (request.result as StoredVisualAdDraft)
            : null,
        );
      request.onerror = () =>
        reject(
          request.error ?? new Error("Could not restore the saved visual ad."),
        );
    });
  } finally {
    database.close();
  }
}

export async function saveVisualAdDraft(draft: StoredVisualAdDraft) {
  if (visualAdDraftBytes(draft) > MAX_VISUAL_AD_DRAFT_BYTES)
    throw new Error(
      "This photo is too large to save locally. Download the draft before leaving, or use a smaller original.",
    );
  const database = await openDraftDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      const store = transaction.objectStore("drafts");
      store.put(draft);
      const request = store.getAll();
      request.onsuccess = () => {
        for (const id of visualAdDraftsToRemove(
          request.result as StoredVisualAdDraft[],
          draft.id,
        ))
          store.delete(id);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error(
              "Could not save this draft locally. Download it before leaving.",
            ),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error(
              "Draft storage is full or unavailable. Download this draft before leaving.",
            ),
        );
    });
  } finally {
    database.close();
  }
}
