import { describe, expect, it } from "vitest";
import {
  agoLabel,
  mirroredNote,
  platformTargetHint,
  publisherBannerLine,
  type PublisherAutomationOverview
} from "@/lib/publisher/publishOverview";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const automation = (
  task: Partial<PublisherAutomationOverview["task"]> = {},
  paused = false
): PublisherAutomationOverview => ({
  paused,
  task: { state: "ready", lastRunAt: minutesAgo(5), nextRunAt: null, ...task }
});

describe("the publisher line at the top of the Uploading Center", () => {
  it("says paused first, and links to Automations", () => {
    const line = publisherBannerLine(automation({ state: "missing" }, true), NOW);
    expect(line).toMatchObject({ tone: "warning", href: "/automations" });
    expect(line?.text).toMatch(/^Publisher paused/);
  });

  it("tells him the command to run when the runner is not installed", () => {
    const line = publisherBannerLine(automation({ state: "missing", lastRunAt: null }), NOW);
    expect(line).toEqual({
      tone: "warning",
      text: "Publisher runner not installed - run npm run publish:register in the app folder."
    });
  });

  it("is only a muted line when the runner is healthy and recent", () => {
    expect(publisherBannerLine(automation({ lastRunAt: minutesAgo(12) }), NOW)).toEqual({
      tone: "muted",
      text: "Publisher last ran 12 min ago."
    });
  });

  it("turns into a warning once the runner has been quiet for hours", () => {
    const line = publisherBannerLine(automation({ lastRunAt: minutesAgo(5 * 60) }), NOW);
    expect(line?.tone).toBe("warning");
    expect(line?.text).toMatch(/^Publisher last ran 5 h ago/);
  });

  it("flags a disabled task, and stays silent when the state could not be checked", () => {
    expect(publisherBannerLine(automation({ state: "disabled" }), NOW)?.tone).toBe("warning");
    expect(publisherBannerLine(automation({ state: "unknown", lastRunAt: null }), NOW)).toBeNull();
    expect(publisherBannerLine(undefined, NOW)).toBeNull();
  });

  it("does not say the runner is missing for a copy that points at another folder", () => {
    const line = publisherBannerLine(automation({ state: "other-checkout", lastRunAt: null }), NOW);
    expect(line?.tone).toBe("muted");
    expect(line?.text).not.toMatch(/not installed/);
  });
});

describe("agoLabel", () => {
  it("reads in minutes, hours and days", () => {
    const at = (minutes: number) => agoLabel(NOW.getTime() - minutes * 60_000, NOW.getTime());
    expect(at(0)).toBe("just now");
    expect(at(59)).toBe("59 min ago");
    expect(at(180)).toBe("3 h ago");
    expect(at(60 * 24 * 4)).toBe("4 days ago");
  });
});

describe("mirroredNote", () => {
  const names = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", linkedin: "LinkedIn" } as const;

  it("names where the lead is copied to", () => {
    expect(mirroredNote({ enabled: true, lead: "youtube", targets: ["instagram", "facebook"] }, names)).toBe(
      "YouTube + Instagram + Facebook (mirrored)"
    );
  });

  it("is null when the mirror is off or has nowhere to go", () => {
    expect(mirroredNote({ enabled: false, lead: "youtube", targets: ["instagram"] }, names)).toBeNull();
    expect(mirroredNote({ enabled: true, lead: "youtube", targets: ["youtube"] }, names)).toBeNull();
    expect(mirroredNote(undefined, names)).toBeNull();
  });
});

describe("platformTargetHint", () => {
  const names = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", linkedin: "LinkedIn" } as const;
  const mirror = { enabled: true, lead: "youtube", targets: ["instagram", "facebook"] } as const;

  it("says what the mirror adds to the lead", () => {
    expect(platformTargetHint("youtube", { ...mirror, targets: [...mirror.targets] }, names)).toBe(
      "Books YouTube; the publisher copies that schedule to Instagram and Facebook."
    );
  });

  it("names one platform alone when nothing mirrors", () => {
    expect(platformTargetHint("youtube", undefined, names)).toBe("Books YouTube only.");
    expect(platformTargetHint("tiktok", { ...mirror, targets: [...mirror.targets] }, names)).toBe("Books TikTok only.");
  });

  it("says Instagram carries the Facebook Page, and what all books", () => {
    expect(platformTargetHint("instagram", undefined, names)).toContain("Facebook Page too");
    expect(platformTargetHint("facebook", undefined, names)).toBe("Books the Facebook Page only.");
    expect(platformTargetHint("all", undefined, names)).toContain("YouTube, TikTok, Instagram and Facebook");
    expect(platformTargetHint("all", undefined, names)).not.toContain("LinkedIn");
  });

  it("says LinkedIn posts as the profile or page chosen in Settings, and is not part of all", () => {
    expect(platformTargetHint("linkedin", undefined, names)).toBe(
      "Books LinkedIn only; it posts as the profile or company page chosen in Settings > Accounts."
    );
  });
});
