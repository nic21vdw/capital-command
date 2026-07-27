import { describe, expect, it, vi } from "vitest";
import { cleanYtDlpError, clientAttemptArgs, downloadWithFallbacks, YT_PLAYER_CLIENTS } from "./download";

/**
 * The clip pipeline died on every clip because a live/DVR YouTube VOD only
 * exposed SABR-streamed video: yt-dlp exited 1 with an opaque streaming URL, a
 * message that matched none of the old "transient" patterns, so the client
 * rotation that could have recovered it was skipped. These tests pin the
 * recovered behaviour: try every player client on ANY failure.
 */

// The exact kind of failure the screenshot showed: exit code 1 whose stderr
// tail is a bare, scheme-less GVS URL fragment (the "https://" got sliced off).
const DVR_FAILURE = new Error(
  "yt-dlp exited with code 1: 13%2C617%2C619/keepalive/yes/fexp/51565115/itag/0/playlist_type/DVR/sparams/expire"
);

describe("clientAttemptArgs", () => {
  it("tries the default client first, then every YouTube player-client fallback", () => {
    const attempts = clientAttemptArgs();
    expect(attempts[0]).toEqual([]); // default client: no extractor override
    expect(attempts).toHaveLength(YT_PLAYER_CLIENTS.length + 1);
    for (const clients of YT_PLAYER_CLIENTS) {
      expect(attempts.some((a) => a.includes(`youtube:player_client=${clients}`))).toBe(true);
    }
  });
});

describe("downloadWithFallbacks", () => {
  it("returns the first client that succeeds", async () => {
    const attempt = vi.fn(async (clientArgs: string[]) => {
      // Fail on the default client, succeed once a fallback client is passed.
      if (clientArgs.length === 0) throw DVR_FAILURE;
      return "produced.mp4";
    });

    await expect(downloadWithFallbacks(attempt)).resolves.toBe("produced.mp4");
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("keeps trying alternate clients even after an unrecognized (non-transient) failure", async () => {
    // Regression: the old loop broke out of the rotation on this exact error,
    // so the recovering clients were never attempted.
    const attempt = vi.fn(async (clientArgs: string[]) => {
      if (!clientArgs.includes("youtube:player_client=android,ios,web")) throw DVR_FAILURE;
      return "produced.mp4";
    });

    await expect(downloadWithFallbacks(attempt)).resolves.toBe("produced.mp4");
    expect(attempt).toHaveBeenCalledTimes(clientAttemptArgs().length);
  });

  it("throws a readable error, not URL soup, when every client fails", async () => {
    const attempt = vi.fn(async () => {
      throw DVR_FAILURE;
    });

    await expect(downloadWithFallbacks(attempt)).rejects.toThrow(/live\/DVR/i);
    // The raw streaming-URL garbage never reaches the user.
    await expect(downloadWithFallbacks(attempt)).rejects.not.toThrow(/keepalive/);
  });
});

describe("cleanYtDlpError", () => {
  it("turns the opaque DVR streaming-URL failure into a clear message", () => {
    expect(cleanYtDlpError(DVR_FAILURE)).toMatch(/live\/DVR/i);
  });

  it("redacts full media URLs from otherwise-passthrough messages", () => {
    expect(cleanYtDlpError(new Error("boom https://cdn.example.com/xyz?a=b failed"))).toContain("[media URL]");
  });

  it("explains a 403 without leaking the temporary URL", () => {
    expect(cleanYtDlpError(new Error("HTTP Error 403: Forbidden"))).toMatch(/temporary media URL/i);
  });
});
