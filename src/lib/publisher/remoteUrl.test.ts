import { describe, expect, it } from "vitest";
import { remoteUrlFor } from "@/lib/publisher/remoteUrl";

describe("remoteUrlFor", () => {
  it("links a YouTube video from its id, whatever its status", () => {
    expect(remoteUrlFor("youtube", "abc123")).toBe("https://www.youtube.com/watch?v=abc123");
    expect(remoteUrlFor("youtube", "abc123", "scheduled")).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("links a Facebook post only once it is published", () => {
    expect(remoteUrlFor("facebook", "1234_5678", "published")).toBe("https://www.facebook.com/1234_5678");
    expect(remoteUrlFor("facebook", "1234_5678", "scheduled")).toBeNull();
    expect(remoteUrlFor("facebook", "1234_5678")).toBeNull();
  });

  it("does not build a URL out of an Instagram media id or a TikTok publish id", () => {
    expect(remoteUrlFor("instagram", "17900000000", "published")).toBeNull();
    expect(remoteUrlFor("tiktok", "7300000000", "published")).toBeNull();
  });

  it("uses a full URL when one was stored", () => {
    expect(remoteUrlFor("tiktok", "https://www.tiktok.com/@me/video/1", "published")).toBe(
      "https://www.tiktok.com/@me/video/1"
    );
  });

  it("answers null without an id, and refuses an id that could break out of the path", () => {
    expect(remoteUrlFor("youtube", undefined)).toBeNull();
    expect(remoteUrlFor("youtube", "  ")).toBeNull();
    expect(remoteUrlFor("facebook", "1/../../evil", "published")).toBeNull();
  });
});
