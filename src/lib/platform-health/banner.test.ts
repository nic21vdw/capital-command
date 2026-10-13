import { describe, expect, it } from "vitest";
import { bannerModel } from "@/lib/platform-health/banner";
import type { PlatformHealthResponse } from "@/lib/platform-health/types";

const NOW = new Date("2026-10-13T15:00:00.000Z");

function response(broken: PlatformHealthResponse["broken"]): PlatformHealthResponse {
  return { ok: broken.length === 0, checkedAt: NOW.toISOString(), broken };
}

const threads = {
  platform: "threads" as const,
  label: "Threads",
  since: "2026-09-24T20:13:48.000Z",
  lastFailureAt: "2026-10-13T14:55:00.000Z",
  reason: "Error validating access token: Session has expired",
  fixUrl: "/settings#accounts",
  failures: 40
};

describe("bannerModel", () => {
  it("is hidden when every platform is healthy", () => {
    expect(bannerModel(response([]), { now: NOW }).visible).toBe(false);
  });

  it("is hidden until the first answer arrives, and when the answer cannot be read", () => {
    expect(bannerModel(null, { now: NOW }).visible).toBe(false);
    expect(bannerModel(undefined, { now: NOW }).visible).toBe(false);
    expect(bannerModel({ nonsense: true } as unknown as PlatformHealthResponse, { now: NOW }).visible).toBe(false);
  });

  it("names the platform, the date it broke, and a Reconnect link into Settings > Accounts", () => {
    const model = bannerModel(response([threads]), { now: NOW, timeZone: "UTC" });

    expect(model.visible).toBe(true);
    expect(model.headline).toBe("Threads has stopped posting");
    expect(model.entries).toEqual([
      {
        platform: "threads",
        label: "Threads",
        reason: "Error validating access token: Session has expired",
        sinceLabel: "Sep 24, 2026",
        agoLabel: "19 days ago",
        fixUrl: "/settings#accounts",
        fixLabel: "Reconnect"
      }
    ]);
  });

  it("lists every broken platform and counts them in the headline", () => {
    const model = bannerModel(
      response([threads, { ...threads, platform: "instagram", label: "Instagram", since: "2026-10-13T09:00:00.000Z" }]),
      { now: NOW, timeZone: "UTC" }
    );

    expect(model.headline).toBe("2 platforms have stopped posting");
    expect(model.entries.map((entry) => [entry.label, entry.agoLabel])).toEqual([
      ["Threads", "19 days ago"],
      ["Instagram", "today"]
    ]);
  });

  it("says yesterday for a break a day old", () => {
    const model = bannerModel(response([{ ...threads, since: "2026-10-12T09:00:00.000Z" }]), { now: NOW, timeZone: "UTC" });
    expect(model.entries[0].agoLabel).toBe("yesterday");
  });

  it("only ever links inside the app", () => {
    const model = bannerModel(response([{ ...threads, fixUrl: "https://evil.example/login" }]), { now: NOW, timeZone: "UTC" });
    expect(model.entries[0].fixUrl).toBe("/settings#accounts");
  });

  it("keeps a long reason short enough for a banner", () => {
    const model = bannerModel(response([{ ...threads, reason: "x".repeat(900) }]), { now: NOW, timeZone: "UTC" });
    expect(model.entries[0].reason.length).toBeLessThanOrEqual(160);
  });

  it("survives a date it cannot read", () => {
    const model = bannerModel(response([{ ...threads, since: "not a date" }]), { now: NOW, timeZone: "UTC" });
    expect(model.visible).toBe(true);
    expect(model.entries[0].sinceLabel).toBe("an unknown date");
    expect(model.entries[0].agoLabel).toBe("");
  });
});
