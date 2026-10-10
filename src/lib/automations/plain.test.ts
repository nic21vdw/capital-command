import { describe, expect, it } from "vitest";
import { issueLine, plainReason } from "@/lib/automations/plain";

describe("automation issue lines", () => {
  it("turns Threads error 190 into a reconnect instruction", () => {
    expect(issueLine("Timezone bugs", "Threads API error (190): the access token has expired. Reconnect the account in Settings, then retry.", "threads")).toBe(
      "Timezone bugs: Threads connection expired - reconnect in Settings"
    );
  });

  it("truncates a long title and keeps the reason short", () => {
    const line = issueLine("Three agents one repo, how I stop merge fights every single time it happens", "TikTok refresh token expired or revoked (invalid_grant).", "tiktok");
    expect(line).toMatch(/^Three agents one repo, how I stop merge fights\S*…: TikTok connection expired - reconnect in Settings$/);
  });

  it("names the TikTok inbox and the duplicate-title refusals plainly", () => {
    expect(plainReason("TikTok inbox upload refused: spam_risk_too_many_pending_share. TikTok is holding as many unfinished uploads", "tiktok")).toContain("too many unfinished uploads");
    expect(plainReason('"X" is already on the channel (https://youtube.com/watch?v=1) - this upload was stopped rather than posting it a second time.', "youtube")).toBe(
      "already on the YouTube channel - retitle it before booking again"
    );
  });

  it("keeps an unrecognised reason, shortened", () => {
    expect(plainReason("Owner email is missing.", "podcast")).toBe("Owner email is missing.");
    expect(plainReason("x ".repeat(200), "podcast").length).toBeLessThanOrEqual(150);
  });
});
