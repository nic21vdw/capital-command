import { describe, expect, it } from "vitest";
import { nextVisitedTabs } from "@/components/ui/tab-keepalive";

const IDS = ["youtube", "tiktok", "instagram", "facebook"] as const;

describe("nextVisitedTabs", () => {
  it("marks the active tab and its neighbors", () => {
    const visited = nextVisitedTabs(new Set(), "tiktok", IDS);
    expect([...visited].sort()).toEqual(["instagram", "tiktok", "youtube"]);
  });

  it("keeps previously visited tabs when switching away", () => {
    const first = nextVisitedTabs(new Set(), "youtube", IDS);
    const second = nextVisitedTabs(first, "facebook", IDS);
    expect(second.has("youtube")).toBe(true);
    expect(second.has("facebook")).toBe(true);
    expect(second.has("instagram")).toBe(true);
  });

  it("handles ends of the list without inventing neighbors", () => {
    expect(nextVisitedTabs(new Set(), "youtube", IDS).has("tiktok")).toBe(true);
    expect(nextVisitedTabs(new Set(), "youtube", IDS).has("instagram")).toBe(false);
    expect(nextVisitedTabs(new Set(), "facebook", IDS).has("instagram")).toBe(true);
    expect(nextVisitedTabs(new Set(), "facebook", IDS).has("tiktok")).toBe(false);
  });
});
