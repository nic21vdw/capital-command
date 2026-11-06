import { describe, expect, it } from "vitest";
import { linkedinTabVisible, visiblePlatformTabs } from "@/components/uploading-center/platform-tabs";
import type { PlatformId } from "@/lib/publisher/types";

const tabs = (["youtube", "tiktok", "instagram", "facebook", "linkedin"] as PlatformId[]).map((id) => ({ id }));
const none = new Map<PlatformId, number>();

describe("the LinkedIn tab", () => {
  it("stays out of the Uploading Center until LinkedIn is connected", () => {
    const accounts = [{ platform: "linkedin" as const, connected: false }, { platform: "youtube" as const, connected: true }];
    expect(linkedinTabVisible(accounts, none)).toBe(false);
    expect(visiblePlatformTabs(tabs, accounts, none).map((tab) => tab.id)).toEqual(["youtube", "tiktok", "instagram", "facebook"]);
  });

  it("appears once LinkedIn is connected", () => {
    const accounts = [{ platform: "linkedin" as const, connected: true }];
    expect(visiblePlatformTabs(tabs, accounts, none).map((tab) => tab.id)).toContain("linkedin");
  });

  it("appears when a post is already booked to it, so no booking is hidden", () => {
    const accounts = [{ platform: "linkedin" as const, connected: false }];
    expect(linkedinTabVisible(accounts, new Map([["linkedin", 2]]))).toBe(true);
  });
});
