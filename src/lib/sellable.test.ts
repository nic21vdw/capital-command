import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyData, seedData } from "@/lib/mockData/seed";
import { ensureSetupStamp, looksUsed, tracksFinances } from "@/lib/setup";
import { DEFAULT_X_BRIEF, settingsSchema } from "@/lib/storage/schemas";
import { CONNECTIONS, CONNECTION_FIELD_NAMES } from "@/lib/publisher/connections";

/**
 * What has to stay true for this app to be handed to someone else.
 *
 * It shipped one person's brokerage accounts, holdings, expense receipts and
 * creator profile as the document a fresh install wrote to disk on first page
 * load — so a buyer's first screen was a dashboard of a stranger's money — and
 * signed their exported carousels and uploaded clips with his name and handles.
 * These pin the fixes rather than the plumbing: a regression here is somebody
 * else's identity going out under a customer's name.
 */

describe("what a fresh install opens on", () => {
  it("is empty", () => {
    expect(emptyData.accounts).toEqual([]);
    expect(emptyData.holdings).toEqual([]);
    expect(emptyData.expenses).toEqual([]);
    expect(emptyData.contentItems).toEqual([]);
    expect(emptyData.watchlist).toEqual([]);
    expect(emptyData.creatorProfile.channelName).toBe("");
    expect(emptyData.creatorProfile.handle).toBe("");
  });

  it("has not been through setup, so the setup screen shows", () => {
    expect(emptyData.settings.setupCompletedAt).toBeUndefined();
    expect(looksUsed(emptyData)).toBe(false);
    expect(ensureSetupStamp(emptyData).changed).toBe(false);
  });

  it("carries no standing clip description, so nothing is credited to anyone", () => {
    expect(emptyData.settings.clipDescription ?? "").toBe("");
  });
});

describe("an install that was already running", () => {
  // It predates the setup screen, so its settings carry no stamp. Showing it a
  // first-run screen on the next release would be the upgrade breaking it.
  it("is stamped as set up rather than shown the setup screen", () => {
    const used = { ...emptyData, creatorProfile: { ...emptyData.creatorProfile, channelName: "Someone" } };
    expect(looksUsed(used)).toBe(true);
    const stamped = ensureSetupStamp(used);
    expect(stamped.changed).toBe(true);
    expect(stamped.data.settings.setupCompletedAt).toBeTruthy();
  });

  it("is not stamped twice", () => {
    const already = ensureSetupStamp({
      ...emptyData,
      contentItems: [...seedData.contentItems],
      settings: { ...emptyData.settings, setupCompletedAt: "2026-01-01T00:00:00.000Z" }
    });
    expect(already.changed).toBe(false);
    expect(already.data.settings.setupCompletedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("the demo document", () => {
  it("names nobody real", () => {
    const json = JSON.stringify(seedData);
    for (const term of ["Vandewetering", "nvandewetering", "nic21vdw", "Wealthsimple", "Questrade", "EQ Bank"]) {
      expect(json).not.toContain(term);
    }
  });

  it("carries no receipt, order or card details", () => {
    const json = JSON.stringify(seedData);
    expect(json).not.toMatch(/ending \d{4}/i);
    expect(json).not.toMatch(/receipt|order #|web code/i);
  });
});

describe("the X reply brief a new install starts from", () => {
  it("is a placeholder, not one person's positioning", () => {
    expect(DEFAULT_X_BRIEF).not.toContain("Vandewetering");
    expect(DEFAULT_X_BRIEF).not.toContain("nic21vdw");
    expect(DEFAULT_X_BRIEF).toContain("REPLACE THIS");
  });
});

describe("the accounts a buyer can connect", () => {
  it("names every credential exactly once", () => {
    expect(new Set(CONNECTION_FIELD_NAMES).size).toBe(CONNECTION_FIELD_NAMES.length);
  });

  it("either signs in through the app or says plainly that it does not", () => {
    for (const connection of CONNECTIONS) {
      expect(connection.fields.length).toBeGreaterThan(0);
      expect(Boolean(connection.oauth) || Boolean(connection.manualNote)).toBe(true);
    }
  });

  it("covers the platforms the publisher posts to", () => {
    const ids = CONNECTIONS.map((connection) => connection.id);
    for (const id of ["youtube", "tiktok", "instagram", "facebook", "threads", "spotify"]) {
      expect(ids).toContain(id);
    }
  });
});

describe("the settings that make an install someone's own", () => {
  it("default to empty rather than to somebody's", () => {
    const settings = settingsSchema.parse({ currency: "CAD" });
    expect(settings.clipDescription).toBe("");
    expect(settings.setupCompletedAt).toBeUndefined();
  });
});

describe("the personal finance screens", () => {
  // A portfolio tracker sharing an app with a publishing pipeline. Not what the
  // pack sells, and not something to delete either - somebody is using it.
  it("are off on an install that is not tracking a portfolio", () => {
    expect(tracksFinances(emptyData)).toBe(false);
    expect(emptyData.settings.personalDashboard).toBeUndefined();
    expect(ensureSetupStamp(emptyData).data.settings.personalDashboard).toBeUndefined();
  });

  it("are turned on once for an install that already has holdings", () => {
    const used = { ...emptyData, holdings: [...seedData.holdings, { id: "h", ticker: "X" }] } as typeof emptyData;
    expect(tracksFinances(used)).toBe(true);
    expect(ensureSetupStamp(used).data.settings.personalDashboard).toBe(true);
  });

  it("stay off once somebody has turned them off, holdings or not", () => {
    const off = {
      ...emptyData,
      goals: [{ id: "g" }],
      settings: { ...emptyData.settings, personalDashboard: false, setupCompletedAt: "2026-01-01T00:00:00.000Z" }
    } as unknown as typeof emptyData;
    const stamped = ensureSetupStamp(off);
    expect(stamped.changed).toBe(false);
    expect(stamped.data.settings.personalDashboard).toBe(false);
  });

  it("default to off in the schema readers", () => {
    expect(settingsSchema.parse({ currency: "CAD" }).personalDashboard).toBeUndefined();
  });
});

describe("what the pack does not ship", () => {
  // Three screens that were dead weight rather than features: a golf swing
  // analyser and an X reply studio, both behind redirects and imported by
  // nothing, and an avatar generator whose client says in its own header that
  // its endpoint paths are guesses.
  const root = process.cwd();

  it.each([
    "src/app/golf",
    "src/components/golf",
    "src/lib/golf",
    "src/app/x-strategy",
    "src/app/api/x-strategy",
    "src/components/x-strategy",
    "src/lib/x-strategy/session-brief.ts",
    "src/app/avatar",
    "src/app/api/avatar",
    "src/components/avatar",
    "src/lib/higgsfield"
  ])("%s is gone", (relative) => {
    expect(existsSync(join(root, relative))).toBe(false);
  });

  it("keeps the date helper the rest of the app imports from x-strategy", () => {
    expect(existsSync(join(root, "src/lib/x-strategy/analytics.ts"))).toBe(true);
  });
});
