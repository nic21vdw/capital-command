import { describe, expect, it } from "vitest";
import { linksFromAccounts } from "@/lib/publisher/usePlatformConnections";

describe("linksFromAccounts", () => {
  it("is connected only when an account is signed in and its connection works", () => {
    const links = linksFromAccounts([
      { platform: "instagram", connected: true },
      { platform: "facebook", connected: true, needsReconnect: true },
      { platform: "tiktok", connected: false }
    ]);
    expect(links.instagram?.connected).toBe(true);
    expect(links.facebook?.connected).toBe(false);
    expect(links.tiktok?.connected).toBe(false);
    expect(links.youtube).toBeUndefined();
  });

  it("lets one live account outweigh a dead one on the same network", () => {
    expect(linksFromAccounts([{ platform: "youtube", connected: false }, { platform: "youtube", connected: true }]).youtube?.connected).toBe(true);
  });
});
