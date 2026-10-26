import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { bannerModel } from "@/lib/platform-health/banner";
import { LINKEDIN_KEYS } from "@/lib/publisher/linkedinKeys";
import type { PlatformHealthResponse } from "@/lib/platform-health/types";

const NOW = new Date("2026-10-13T15:00:00.000Z");
const DAY = 86_400_000;

beforeEach(async () => {
  await rm(dataPath("publisher-tokens.json"), { force: true });
  await rm(dataPath("platform-auth.json"), { force: true });
  vi.stubEnv("LINKEDIN_CLIENT_ID", "li-client");
  vi.stubEnv("LINKEDIN_CLIENT_SECRET", "li-secret");
  vi.resetModules();
});

afterEach(() => vi.unstubAllEnvs());

async function seed(values: { access?: number; refresh?: number; refreshExpires?: number | null }) {
  const { setCachedTokens } = await import("@/lib/publisher/tokens");
  await setCachedTokens({
    [LINKEDIN_KEYS.accessToken]: "li-access",
    [LINKEDIN_KEYS.accessExpiresAt]: String(NOW.getTime() + (values.access ?? 60 * DAY)),
    [LINKEDIN_KEYS.author]: "urn:li:person:abc",
    ...(values.refresh !== undefined ? { [LINKEDIN_KEYS.refreshToken]: "li-refresh" } : {}),
    ...(values.refreshExpires != null ? { [LINKEDIN_KEYS.refreshExpiresAt]: String(NOW.getTime() + values.refreshExpires) } : {})
  });
}

async function expiring() {
  return (await import("@/lib/platform-health/expiry")).expiringConnections(NOW);
}

describe("a LinkedIn sign-in that cannot renew itself", () => {
  it("is flagged seven days ahead", async () => {
    await seed({ access: 6 * DAY + 3_600_000 });
    expect(await expiring()).toEqual([
      expect.objectContaining({
        platform: "linkedin",
        accountId: "linkedin-primary",
        daysLeft: 7,
        expired: false,
        expiresAt: new Date(NOW.getTime() + 6 * DAY + 3_600_000).toISOString(),
        fixUrl: "/settings#accounts"
      })
    ]);
  });

  it("is not flagged earlier than that", async () => {
    await seed({ access: 8 * DAY });
    expect(await expiring()).toEqual([]);
  });

  it("says so once it has expired", async () => {
    await seed({ access: -2 * DAY });
    const [entry] = await expiring();
    expect(entry).toMatchObject({ expired: true, daysLeft: 0 });
    expect(entry.reason).toContain("expired");
  });

  it("is not flagged when LinkedIn was never connected", async () => {
    expect(await expiring()).toEqual([]);
  });
});

describe("a LinkedIn sign-in with a refresh token", () => {
  it("is left alone while the access token is about to lapse, because it renews itself", async () => {
    await seed({ access: 2 * DAY, refresh: 1, refreshExpires: 300 * DAY });
    expect(await expiring()).toEqual([]);
  });

  it("is flagged when the refresh token itself is about to lapse", async () => {
    await seed({ access: 2 * DAY, refresh: 1, refreshExpires: 5 * DAY });
    expect(await expiring()).toEqual([expect.objectContaining({ platform: "linkedin", daysLeft: 5 })]);
  });

  it("is left alone when the refresh token's lifetime is not known", async () => {
    await seed({ access: 2 * DAY, refresh: 1, refreshExpires: null });
    expect(await expiring()).toEqual([]);
  });
});

describe("what the health endpoint and the banner say", () => {
  it("adds the warning to the platform health answer without calling the account broken", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    try {
      await seed({ access: 4 * DAY });
      const { GET } = await import("@/app/api/health/platforms/route");
      const health = (await (await GET()).json()) as PlatformHealthResponse;
      expect(health.ok).toBe(true);
      expect(health.broken).toEqual([]);
      expect(health.expiring).toEqual([expect.objectContaining({ platform: "linkedin", displayName: "LinkedIn", daysLeft: 4 })]);
    } finally { vi.useRealTimers(); }
  });

  it("shows a banner that asks for a reconnect before anything stops", async () => {
    const response: PlatformHealthResponse = {
      ok: true,
      checkedAt: NOW.toISOString(),
      broken: [],
      expiring: [
        {
          platform: "linkedin",
          accountId: "linkedin-primary",
          label: "LinkedIn",
          displayName: "LinkedIn",
          expiresAt: new Date(NOW.getTime() + 4 * DAY).toISOString(),
          daysLeft: 4,
          expired: false,
          reason: "LinkedIn does not renew this sign-in by itself.",
          fixUrl: "/settings#accounts"
        }
      ]
    };

    const model = bannerModel(response, { now: NOW, timeZone: "UTC" });

    expect(model.visible).toBe(true);
    expect(model.headline).toBe("LinkedIn sign-in expires in 4 days");
    expect(model.entries).toEqual([
      expect.objectContaining({
        key: "linkedin:linkedin-primary",
        displayName: "LinkedIn",
        lead: "expires Oct 17, 2026",
        fixUrl: "/settings#accounts",
        fixLabel: "Reconnect"
      })
    ]);
  });

  it("keeps the broken headline when something has already stopped", () => {
    const model = bannerModel(
      {
        ok: false,
        checkedAt: NOW.toISOString(),
        broken: [
          {
            platform: "threads",
            accountId: "primary",
            label: "Threads",
            displayName: "Threads",
            since: "2026-10-12T09:00:00.000Z",
            lastFailureAt: "2026-10-13T09:00:00.000Z",
            reason: "Session has expired",
            fixUrl: "/settings#accounts",
            failures: 3
          }
        ],
        expiring: [
          {
            platform: "linkedin",
            accountId: "linkedin-primary",
            label: "LinkedIn",
            displayName: "LinkedIn",
            expiresAt: new Date(NOW.getTime() + 4 * DAY).toISOString(),
            daysLeft: 4,
            expired: false,
            reason: "x",
            fixUrl: "/settings#accounts"
          }
        ]
      },
      { now: NOW, timeZone: "UTC" }
    );
    expect(model.headline).toBe("Threads has stopped posting");
    expect(model.entries).toHaveLength(2);
  });
});
