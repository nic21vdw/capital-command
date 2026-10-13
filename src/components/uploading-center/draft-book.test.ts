import { describe, expect, it } from "vitest";
import { planAutoAssign } from "@/components/uploading-center/bulk";
import { createDraftBook, type DraftMap } from "@/components/uploading-center/draft-book";
import type { ClipDraft, ReadyClip } from "@/components/uploading-center/use-uploading-center";
import type { ScheduleSlot } from "@/lib/publisher/slots";

const clip = (id: string): ReadyClip => ({
  key: `job1/${id}.mp4`,
  jobId: "job1",
  clipId: id,
  file: `${id}.mp4`,
  allFiles: [`${id}.mp4`],
  headline: id,
  durationSec: 30,
  thumbnailUrl: "",
  previewUrl: "",
  startSec: 0,
  needsRerender: false
});

const slot = (utc: string): ScheduleSlot => ({
  id: utc,
  dateKey: utc.slice(0, 10),
  dateLabel: utc.slice(0, 10),
  time: utc.slice(11, 16),
  utc,
  past: false,
  today: false,
  bookable: true
});

const blank = (clipItem: ReadyClip): ClipDraft => ({
  title: clipItem.headline,
  caption: "",
  platform: "youtube",
  slotUtc: ""
});

const clips = ["a", "b", "c", "d"].map(clip);
const slots = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"].map((day) => slot(`${day}T15:00:00.000Z`));

/**
 * React applies a state write on the next render. This stands in for it: the
 * published map is only what a render would show, and `render()` is the moment
 * React catches up. A bulk action runs between renders.
 */
function fakeReact() {
  let queued: DraftMap | null = null;
  let rendered: DraftMap = {};
  const book = createDraftBook((next) => {
    queued = next;
  });
  return {
    book,
    rendered: () => rendered,
    render: () => {
      if (queued) rendered = queued;
    }
  };
}

describe("the draft book a bulk action reads", () => {
  it("shows a write to the very next read, with no render in between", () => {
    const { book, rendered } = fakeReact();
    book.put("k", { ...blank(clips[0]), caption: "written" });
    expect(book.read().k.caption).toBe("written");
    expect(rendered().k).toBeUndefined();
  });

  it("hands React the new map, and nothing when an update changes nothing", () => {
    const published: DraftMap[] = [];
    const book = createDraftBook((next) => published.push(next));
    book.update((current) => current);
    expect(published).toHaveLength(0);
    book.put("k", blank(clips[0]));
    expect(published).toEqual([{ k: blank(clips[0]) }]);
  });

  // The bug: "Schedule 4 clips" wrote a caption per clip, then planned the booking in
  // the same tick as the last write. The ref it planned from was refreshed by a render
  // effect, so the LAST clip was planned from its stale draft - no caption, default tags.
  it("plans every booking with the caption written for it, including the last one", () => {
    const { book } = fakeReact();
    for (const entry of clips) book.put(entry.key, { ...blank(entry), caption: `caption for ${entry.clipId}` });
    const plan = planAutoAssign({
      clips,
      draftFor: (entry) => book.read()[entry.key] ?? blank(entry),
      isScheduled: () => false,
      slots,
      isTargetSlotTaken: () => false
    });
    expect(plan.assignments.map(({ clip: entry, draft }) => [entry.clipId, draft.caption])).toEqual([
      ["a", "caption for a"],
      ["b", "caption for b"],
      ["c", "caption for c"],
      ["d", "caption for d"]
    ]);
    expect(plan.assignments.every(({ draft }) => draft.slotUtc !== "")).toBe(true);
  });

  it("is what a render-refreshed mirror gets wrong (the old behaviour, kept as the control)", () => {
    const react = fakeReact();
    // The old ref: only brought up to date when a render happened.
    let mirror: DraftMap = {};
    const syncMirror = () => {
      react.render();
      mirror = react.rendered();
    };
    for (const [index, entry] of clips.entries()) {
      react.book.put(entry.key, { ...blank(entry), caption: `caption for ${entry.clipId}` });
      // The awaits between clips let React render, except after the last write.
      if (index < clips.length - 1) syncMirror();
    }
    expect(mirror[clips[2].key].caption).toBe("caption for c");
    expect(mirror[clips[3].key]).toBeUndefined();
    expect(react.book.read()[clips[3].key].caption).toBe("caption for d");
  });

  it("keeps a typed edit made between two bulk writes", () => {
    const { book } = fakeReact();
    book.put("a", { ...blank(clips[0]), caption: "AI" });
    const typed = { ...book.read().a, caption: "typed by hand" };
    book.put("a", typed);
    book.put("b", { ...blank(clips[1]), caption: "AI b" });
    expect(book.read().a.caption).toBe("typed by hand");
  });
});
