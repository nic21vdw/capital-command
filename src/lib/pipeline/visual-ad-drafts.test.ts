import { describe, expect, it } from "vitest";
import { defaultVisualAdSettings } from "@/lib/pipeline/visual-ad-render";
import {
  loadVisualAdDraft,
  MAX_VISUAL_AD_DRAFT_BYTES,
  MAX_VISUAL_AD_DRAFTS,
  saveVisualAdDraft,
  visualAdDraftBytes,
  visualAdDraftId,
  visualAdDraftsToRemove,
  type StoredVisualAdDraft,
} from "@/lib/pipeline/visual-ad-drafts";

function draft(
  id: string,
  updatedAt: number,
  imageBytes = 20,
): StoredVisualAdDraft {
  return {
    id,
    updatedAt,
    settings: defaultVisualAdSettings("A real hook"),
    original: {
      src: "x".repeat(imageBytes),
      width: 1920,
      height: 1080,
      origin: "stream-frame",
      name: "Original stream frame",
      capturedAt: "2026-10-01T12:00:00Z",
      sourceTime: 60,
    },
    retouched: null,
    useRetouched: false,
    identityReviewed: false,
  };
}

describe("isolated bounded visual ad drafts", () => {
  it("separates streams and moments even when titles match", () => {
    expect(visualAdDraftId("first", "Same title", 60)).not.toBe(
      visualAdDraftId("second", "Same title", 60),
    );
    expect(visualAdDraftId("first", "Same title", 60)).not.toBe(
      visualAdDraftId("first", "Same title", 120),
    );
    expect(visualAdDraftId("first", "Old title", 60)).toBe(
      visualAdDraftId("first", "Renamed title", 60),
    );
  });

  it("keeps the active draft and the five newest other drafts", () => {
    const drafts = Array.from({ length: 9 }, (_, index) =>
      draft(String(index), index),
    );
    const remove = visualAdDraftsToRemove(drafts, "0");
    expect(remove).toEqual(["3", "2", "1"]);
    expect(drafts.length - remove.length).toBe(MAX_VISUAL_AD_DRAFTS);
    expect(remove).not.toContain("0");
  });

  it("bounds total stored images, including both original and retouch", () => {
    const original = draft("active", 1, 8 * 1024 * 1024);
    original.retouched = { ...original.original, origin: "retouched-import" };
    const drafts = [
      original,
      draft("other", 2, 9 * 1024 * 1024),
      draft("small", 3),
    ];
    const remove = visualAdDraftsToRemove(drafts, "active");
    expect(remove).toContain("other");
    expect(remove).not.toContain("active");
    expect(
      drafts
        .filter((entry) => !remove.includes(entry.id))
        .reduce((bytes, entry) => bytes + visualAdDraftBytes(entry), 0),
    ).toBeLessThanOrEqual(MAX_VISUAL_AD_DRAFT_BYTES);
  });

  it("reports unavailable browser storage instead of claiming the draft saved", async () => {
    await expect(loadVisualAdDraft("one")).rejects.toThrow(
      "Draft storage is unavailable",
    );
    await expect(saveVisualAdDraft(draft("one", 1))).rejects.toThrow(
      "Draft storage is unavailable",
    );
  });

  it("refuses a single oversized draft before opening the database", async () => {
    await expect(
      saveVisualAdDraft(draft("huge", 1, MAX_VISUAL_AD_DRAFT_BYTES / 2)),
    ).rejects.toThrow("too large to save locally");
  });
});
