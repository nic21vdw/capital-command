import { describe, expect, it } from "vitest";
import { legConnectedFrom } from "@/lib/publisher/legConnection";

describe("whether a leg's account is connected (the Uploading Center's rule, server side)", () => {
  const accounts = [
    { id: "youtube-primary", platform: "youtube" as const, connected: true },
    { id: "instagram-primary", platform: "instagram" as const, connected: false },
    { id: "tiktok-primary", platform: "tiktok" as const, connected: true },
    { id: "tiktok-second", platform: "tiktok" as const, connected: false }
  ];
  const connected = legConnectedFrom(accounts);

  it("reads the post's own account", () => {
    expect(connected("tiktok", "tiktok-second")).toBe(false);
    expect(connected("tiktok", "tiktok-primary")).toBe(true);
  });

  it("falls back to the platform's primary when the post's account belongs to another platform", () => {
    expect(connected("youtube", "tiktok-second")).toBe(true);
    expect(connected("instagram", "tiktok-second")).toBe(false);
  });

  it("claims nothing is unconnected until the account list is known", () => {
    expect(legConnectedFrom([])("instagram", "instagram-primary")).toBe(true);
  });
});
