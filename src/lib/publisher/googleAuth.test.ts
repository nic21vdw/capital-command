import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/publisher/config", () => ({
  publisherConfig: () => ({ youtube: { clientId: "client-id", clientSecret: "client-secret" } })
}));

import { googleAuthUrl, YOUTUBE_SCOPES } from "@/lib/publisher/googleAuth";

describe("googleAuthUrl", () => {
  it("asks for watch-time access alongside the publishing scopes", () => {
    const scope = new URL(googleAuthUrl("http://localhost:3000/api/auth/google/callback", "youtube")).searchParams.get("scope")?.split(" ");
    expect(scope).toEqual([...YOUTUBE_SCOPES]);
    expect(scope).toContain("https://www.googleapis.com/auth/yt-analytics.readonly");
    expect(scope).toContain("https://www.googleapis.com/auth/youtube.force-ssl");
  });

  it("asks for no write access beyond what publishing already had", () => {
    const writes = YOUTUBE_SCOPES.filter((scope) => !scope.endsWith(".readonly"));
    expect(writes).toEqual(["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.force-ssl"]);
  });
});
