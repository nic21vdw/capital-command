import { describe, expect, it } from "vitest";
import { historyItemHref, uploadingCenterHref } from "@/lib/automations/links";
import { testItem } from "@/lib/publisher/test-helpers";

describe("automation deep links", () => {
  it("opens a queued post on its first targeted platform", () => {
    expect(uploadingCenterHref(testItem({ id: "a1", platformIds: ["facebook", "instagram"] }))).toBe("/uploading-center?item=a1&platform=instagram");
    expect(uploadingCenterHref(testItem({ id: "b 2", platformIds: [] }))).toBe("/uploading-center?item=b+2");
  });

  it("links history rows that carry an item id, and only those", () => {
    expect(historyItemHref("publisher", "a1")).toBe("/uploading-center?item=a1");
    expect(historyItemHref("publisher", undefined)).toBeNull();
    expect(historyItemHref("threads", "t1")).toBe("/x-posts");
    expect(historyItemHref("podcast", "p1")).toBe("/podcast");
    expect(historyItemHref("ingest", "videoId")).toBeNull();
  });
});
