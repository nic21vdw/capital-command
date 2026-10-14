import { describe, expect, it } from "vitest";
import {
  APPROVE_ALL_ID,
  AWAITING_SURFACE_CAP,
  approveControlId,
  awaitingSurface,
  captionFieldId,
  parseEntryId
} from "@/components/uploading-center/awaiting-surface";
import type { AwaitingEntry } from "@/lib/publisher/approval";

const entry = (overrides: Partial<AwaitingEntry> = {}): AwaitingEntry => ({
  key: "instagram:a",
  channel: "instagram",
  id: "a",
  title: "Reel one",
  caption: "caption one",
  publishAt: "2026-07-23T12:00:00.000Z",
  ...overrides
});

describe("what the Uploading Center tells the canvas about posts awaiting approval", () => {
  it("offers a one-tap approve per post and an approve-all, each flagged so the canvas host asks first", () => {
    const { controls } = awaitingSurface([entry(), entry({ key: "threads:t1", channel: "threads", id: "t1", title: "topic", caption: "words" })], false);
    expect(controls.map((control) => control.id)).toEqual([APPROVE_ALL_ID, "approve:instagram:a", "approve:threads:t1"]);
    expect(controls.every((control) => control.destructive === true)).toBe(true);
    expect(controls.every((control) => control.group === "Awaiting approval")).toBe(true);
  });

  it("says how many posts approve-all will release", () => {
    const { controls } = awaitingSurface([entry(), entry({ id: "b", key: "instagram:b" })], false);
    expect(controls.find((control) => control.id === APPROVE_ALL_ID)?.label).toBe("Approve all (2)");
  });

  it("exposes each caption as a field that can be edited", () => {
    const { fields } = awaitingSurface([entry()], false);
    expect(fields).toEqual([
      expect.objectContaining({ id: "caption:instagram:a", kind: "longtext", value: "caption one", label: expect.stringContaining("Reel one") })
    ]);
  });

  it("reports how many are waiting", () => {
    expect(awaitingSurface([], false).readings).toEqual([{ label: "Awaiting approval", value: "0" }]);
    expect(awaitingSurface([entry(), entry({ id: "b", key: "instagram:b" })], false).readings).toEqual([
      { label: "Awaiting approval", value: "2" }
    ]);
  });

  it("disables approve-all when nothing is waiting, and everything while a request is in flight", () => {
    expect(awaitingSurface([], false).controls).toEqual([expect.objectContaining({ id: APPROVE_ALL_ID, disabled: true })]);
    expect(awaitingSurface([entry()], true).controls.every((control) => control.disabled)).toBe(true);
    expect(awaitingSurface([entry()], false).controls.every((control) => !control.disabled)).toBe(true);
  });

  it("lists at most 25 posts but still counts them all", () => {
    const many = Array.from({ length: 40 }, (_, index) => entry({ id: `p${index}`, key: `instagram:p${index}` }));
    const surface = awaitingSurface(many, false);
    expect(surface.fields).toHaveLength(AWAITING_SURFACE_CAP);
    expect(surface.controls).toHaveLength(AWAITING_SURFACE_CAP + 1);
    expect(surface.readings[0].value).toBe("40");
  });

  it("builds ids that read back to the post they name, ids with colons included", () => {
    expect(parseEntryId("approve", approveControlId("instagram", "a:b"))).toEqual({ channel: "instagram", id: "a:b" });
    expect(parseEntryId("caption", captionFieldId("threads", "thread-1"))).toEqual({ channel: "threads", id: "thread-1" });
    expect(parseEntryId("approve", captionFieldId("threads", "t1"))).toBeNull();
    expect(parseEntryId("approve", "approve:bluesky:x")).toBeNull();
    expect(parseEntryId("approve", "approve:instagram")).toBeNull();
    expect(parseEntryId("approve", "approve-all")).toBeNull();
  });
});
