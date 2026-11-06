import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { YOUTUBE_UNITS_PER_UPLOAD } from "@/lib/publisher/quota";
import { createQuotaLedger, ledgerConfig, quotaLedgerFile, type LedgerConfig } from "@/lib/youtube/quotaLedger";

const NOON = new Date("2026-10-13T19:00:00.000Z");

function ledger(now: () => Date = () => NOON, config: LedgerConfig = ledgerConfig({}), extra: { lockTimeoutMs?: number } = {}) {
  return createQuotaLedger({ now, config: () => config, ...extra });
}

beforeEach(async () => {
  await rm(quotaLedgerFile(), { force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ledgerConfig", () => {
  it("defaults to 6 uploads at the publisher's 1,600 units each and 300 units for everything else", () => {
    expect(YOUTUBE_UNITS_PER_UPLOAD).toBe(1600);
    expect(ledgerConfig({})).toMatchObject({ dailyUnits: 10_000, uploadsPerDay: 6, unitsPerUpload: YOUTUBE_UNITS_PER_UPLOAD, nonUploadUnits: 300 });
  });

  it("reads the non-upload allowance and the upload budget from the environment, ignoring nonsense", () => {
    expect(ledgerConfig({ YOUTUBE_NON_UPLOAD_DAILY_UNITS: "120", YOUTUBE_DAILY_UPLOAD_BUDGET: "4" })).toMatchObject({
      nonUploadUnits: 120,
      uploadsPerDay: 4
    });
    expect(ledgerConfig({ YOUTUBE_NON_UPLOAD_DAILY_UNITS: "lots" }).nonUploadUnits).toBe(300);
    expect(ledgerConfig({ YOUTUBE_NON_UPLOAD_DAILY_UNITS: "-5" }).nonUploadUnits).toBe(300);
  });
});

describe("the allowance", () => {
  it("reserves six uploads at 1,600 units, which leaves room for the 300-unit allowance", async () => {
    expect(await ledger().snapshot()).toMatchObject({
      dailyUnits: 10_000,
      uploadReserve: 9_600,
      nonUploadCapConfigured: 300,
      nonUploadAllowance: 300,
      nonUploadClamped: false,
      spent: 0
    });
  });

  it("caps a bigger allowance at what the upload reserve leaves, and says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const quota = ledger(() => NOON, ledgerConfig({ YOUTUBE_NON_UPLOAD_DAILY_UNITS: "1000" }));

    const state = await quota.snapshot();
    await quota.snapshot();
    await quota.debit(10, "analytics");

    expect(state).toMatchObject({ nonUploadCapConfigured: 1000, nonUploadAllowance: 400, nonUploadClamped: true });
    expect(await quota.debit(391, "inbox")).toMatchObject({ ok: false, reason: "budget" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/YOUTUBE_NON_UPLOAD_DAILY_UNITS/);
    expect(String(warn.mock.calls[0][0])).toMatch(/400/);
  });

  it("leaves nothing for other purposes when the upload budget alone fills the day", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const quota = ledger(() => NOON, ledgerConfig({ YOUTUBE_DAILY_UPLOAD_BUDGET: "7" }));

    expect(await quota.snapshot()).toMatchObject({ uploadReserve: 11_200, nonUploadAllowance: 0 });
    expect(await quota.debit(1, "analytics")).toMatchObject({ ok: false, reason: "budget", remaining: 0 });
  });

  it("does not warn when the allowance fits", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await ledger().debit(5, "analytics");

    expect(warn).not.toHaveBeenCalled();
  });

  it("shares the rest of the day between the non-upload purposes, up to the cap", async () => {
    const quota = ledger();

    expect(await quota.debit(100, "analytics")).toEqual({ ok: true, remaining: 200 });
    expect(await quota.debit(150, "inbox")).toEqual({ ok: true, remaining: 50 });
    expect(await quota.remaining("listening")).toBe(50);
    expect(await quota.debit(51, "outliers")).toMatchObject({ ok: false, reason: "budget", remaining: 50 });
    expect(await quota.debit(50, "listening")).toEqual({ ok: true, remaining: 0 });
    expect(await quota.debit(1, "analytics")).toMatchObject({ ok: false, reason: "budget", remaining: 0 });
  });

  it("breaks the day down by purpose", async () => {
    const quota = ledger();
    await quota.debit(5, "analytics");
    await quota.debit(7, "inbox");
    await quota.debit(3, "analytics");
    await quota.debit(1600, "upload");

    expect(await quota.snapshot()).toMatchObject({
      day: "2026-10-13",
      spent: 1615,
      byPurpose: { analytics: 8, inbox: 7, upload: 1600 },
      nonUploadSpent: 15,
      nonUploadRemaining: 285
    });
  });

  it("never lets other purposes starve uploads: with the allowance spent, an upload still goes through", async () => {
    const quota = ledger();
    await quota.debit(300, "outliers");

    expect(await quota.debit(1, "analytics")).toMatchObject({ ok: false });
    expect(await quota.debit(1600, "upload")).toMatchObject({ ok: true, remaining: 8_100 });
    expect(await quota.remaining("upload")).toBe(8_100);
  });

  it("never refuses an upload, even when the day is already spent: the ledger records it and YouTube is the one to say no", async () => {
    const quota = ledger();
    await quota.debit(9_900, "upload");

    expect(await quota.debit(1600, "upload")).toEqual({ ok: true, remaining: 0 });
    expect((await quota.snapshot()).byPurpose.upload).toBe(11_500);
  });

  it("refuses units that make no sense for other purposes, without writing, and lets an upload through unrecorded", async () => {
    const quota = ledger();

    for (const units of [0, -4, Number.NaN, 2.5]) {
      expect(await quota.debit(units, "analytics")).toMatchObject({ ok: false, reason: "invalid-units" });
    }
    expect(await quota.debit(0, "upload")).toMatchObject({ ok: true, unmetered: true });
    await expect(readFile(quotaLedgerFile(), "utf8")).rejects.toThrow();
  });

  it("holds a small configured day the same way", async () => {
    const quota = ledger(() => NOON, { dailyUnits: 1000, uploadsPerDay: 2, unitsPerUpload: 300, nonUploadUnits: 300 });

    expect(await quota.snapshot()).toMatchObject({ uploadReserve: 600, nonUploadAllowance: 300 });
    expect(await quota.debit(300, "analytics")).toMatchObject({ ok: true });
    expect(await quota.debit(1, "analytics")).toMatchObject({ ok: false, reason: "budget" });
    expect(await quota.debit(600, "upload")).toMatchObject({ ok: true });
  });
});

describe("per-purpose sub-caps inside the allowance", () => {
  it("defaults to 200 units for the inbox and 100 for Listening, read from the environment the old counters used", () => {
    expect(ledgerConfig({}).purposeCaps).toEqual({ inbox: 200, listening: 100 });
    expect(ledgerConfig({ INBOX_YOUTUBE_DAILY_UNITS: "40", YOUTUBE_LISTENING_DAILY_UNITS: "20" }).purposeCaps).toEqual({ inbox: 40, listening: 20 });
    expect(ledgerConfig({ INBOX_YOUTUBE_DAILY_UNITS: "lots", YOUTUBE_LISTENING_DAILY_UNITS: "-1" }).purposeCaps).toEqual({ inbox: 200, listening: 100 });
  });

  it("turns the inbox away at its 200 units even though the allowance has 100 left", async () => {
    const quota = ledger();

    expect(await quota.debit(200, "inbox")).toEqual({ ok: true, remaining: 0 });
    expect(await quota.debit(1, "inbox")).toMatchObject({ ok: false, reason: "budget", remaining: 0 });
    expect(await quota.remaining("inbox")).toBe(0);
    expect(await quota.remaining("analytics")).toBe(100);
    expect(await quota.debit(100, "analytics")).toMatchObject({ ok: true });
  });

  it("turns Listening away at its 100 units, leaving the rest of the allowance to everyone else", async () => {
    const quota = ledger();

    expect(await quota.debit(100, "listening")).toEqual({ ok: true, remaining: 0 });
    expect(await quota.debit(1, "listening")).toMatchObject({ ok: false, reason: "budget", remaining: 0 });
    expect(await quota.remaining("listening")).toBe(0);
    expect(await quota.remaining("outliers")).toBe(200);
  });

  it("applies the smaller of the sub-cap and what the allowance has left", async () => {
    const quota = ledger();
    await quota.debit(250, "analytics");

    expect(await quota.remaining("inbox")).toBe(50);
    expect(await quota.debit(51, "inbox")).toMatchObject({ ok: false, reason: "budget", remaining: 50 });
    expect(await quota.debit(50, "inbox")).toEqual({ ok: true, remaining: 0 });
  });

  it("reports the caps next to the split so a meter can draw them", async () => {
    const quota = ledger();
    await quota.debit(40, "inbox");

    expect(await quota.snapshot()).toMatchObject({ byPurpose: { inbox: 40 }, purposeCaps: { inbox: 200, listening: 100 } });
  });

  it("holds a configured cap of zero as nothing to spend", async () => {
    const quota = ledger(() => NOON, ledgerConfig({ INBOX_YOUTUBE_DAILY_UNITS: "0" }));

    expect(await quota.debit(1, "inbox")).toMatchObject({ ok: false, reason: "budget" });
    expect(await quota.debit(1, "analytics")).toMatchObject({ ok: true });
  });
});

describe("inbox replies", () => {
  it("are never refused by the read budget or the allowance, but are counted against the allowance", async () => {
    const quota = ledger();
    await quota.debit(200, "inbox");
    await quota.debit(100, "listening");
    expect((await quota.snapshot()).nonUploadRemaining).toBe(0);

    expect(await quota.debit(50, "inbox-reply")).toEqual({ ok: true, remaining: 0 });

    const state = await quota.snapshot();
    expect(state.byPurpose).toEqual({ inbox: 200, listening: 100, "inbox-reply": 50 });
    expect(state.nonUploadSpent).toBe(350);
    expect(await quota.debit(1, "analytics")).toMatchObject({ ok: false, reason: "budget" });
  });

  it("takes from the allowance first, so readers give way to a reply", async () => {
    const quota = ledger();

    await quota.debit(50, "inbox-reply");

    expect(await quota.remaining("analytics")).toBe(250);
  });

  it("go through unrecorded when the ledger cannot be read, like an upload", async () => {
    await mkdir(path.dirname(quotaLedgerFile()), { recursive: true });
    await writeFile(quotaLedgerFile(), "{ not json");

    expect(await ledger().debit(50, "inbox-reply")).toMatchObject({ ok: true, unmetered: true });
  });
});

describe("when the ledger cannot be used", () => {
  it("lets an upload through unrecorded and turns every other purpose away as unavailable, leaving a damaged file alone", async () => {
    await mkdir(path.dirname(quotaLedgerFile()), { recursive: true });
    await writeFile(quotaLedgerFile(), "{ not json");
    const quota = ledger();

    expect(await quota.debit(1600, "upload")).toMatchObject({ ok: true, unmetered: true });
    expect(await quota.debit(1, "analytics")).toMatchObject({ ok: false, reason: "unavailable" });
    expect(await readFile(quotaLedgerFile(), "utf8")).toBe("{ not json");
    expect(dataPath("youtube-quota.json")).toBe(quotaLedgerFile());
  });

  it("says the whole day is left for uploads and nothing for the rest when the file cannot be read", async () => {
    await mkdir(path.dirname(quotaLedgerFile()), { recursive: true });
    await writeFile(quotaLedgerFile(), "{ not json");
    const quota = ledger();

    expect(await quota.remaining("upload")).toBe(10_000);
    expect(await quota.remaining("analytics")).toBe(0);
  });

  it("does not wait for a lock held by another process: an upload goes through, anything else is unavailable", async () => {
    const quota = ledger(() => NOON, ledgerConfig({}), { lockTimeoutMs: 40 });
    const lockFile = `${quotaLedgerFile()}.lock`;
    await writeFile(lockFile, JSON.stringify({ pid: process.ppid, token: "another-process", acquiredAt: new Date().toISOString() }));

    try {
      const upload = await quota.debit(1600, "upload");
      const other = await quota.debit(1, "analytics");

      expect(upload).toMatchObject({ ok: true, unmetered: true });
      expect(other).toMatchObject({ ok: false, reason: "unavailable" });
    } finally {
      await rm(lockFile, { force: true });
    }
    expect((await quota.snapshot()).spent).toBe(0);
  });
});

describe("persistence", () => {
  it("lives in data/youtube-quota.json and survives a restart", async () => {
    expect(quotaLedgerFile().replace(/\\/g, "/")).toMatch(/\/youtube-quota\.json$/);
    const before = ledger();
    await before.debit(120, "analytics");

    const afterRestart = ledger();

    expect(await afterRestart.remaining("analytics")).toBe(180);
    expect(await afterRestart.debit(100, "inbox")).toEqual({ ok: true, remaining: 80 });
    expect((await ledger().snapshot()).byPurpose).toEqual({ analytics: 120, inbox: 100 });
  });

  it("applies each debit as a delta to what is on disk, so a second process's spend is never overwritten", async () => {
    const one = ledger();
    const two = ledger();
    await one.snapshot();

    await two.debit(100, "inbox");
    await one.debit(50, "analytics");

    expect((await ledger().snapshot()).byPurpose).toEqual({ inbox: 100, analytics: 50 });
  });

  it("grants exactly the allowance when many debits race, across two ledgers on the same file", { timeout: 20_000 }, async () => {
    const one = ledger();
    const two = ledger();

    const results = await Promise.all(Array.from({ length: 50 }, (_, index) => (index % 2 === 0 ? one : two).debit(10, "analytics")));

    expect(results.filter((result) => result.ok)).toHaveLength(30);
    expect(results.filter((result) => !result.ok && result.reason === "budget")).toHaveLength(20);
    expect((await ledger().snapshot()).nonUploadSpent).toBe(300);
  });

  it("starts a fresh count when the Pacific day turns over", async () => {
    let clock = new Date("2026-10-13T06:59:00.000Z");
    const quota = ledger(() => clock);
    await quota.debit(300, "analytics");
    expect(await quota.snapshot()).toMatchObject({ day: "2026-10-12", nonUploadRemaining: 0 });

    clock = new Date("2026-10-13T07:01:00.000Z");

    expect(await quota.snapshot()).toMatchObject({ day: "2026-10-13", spent: 0, nonUploadRemaining: 300 });
    expect(await quota.debit(10, "analytics")).toEqual({ ok: true, remaining: 290 });
  });
});

describe("nextResetAt", () => {
  it("is the next midnight in Pacific time", () => {
    expect(ledger().nextResetAt(NOON).toISOString()).toBe("2026-10-14T07:00:00.000Z");
    expect(ledger().nextResetAt(new Date("2026-10-13T06:59:00.000Z")).toISOString()).toBe("2026-10-13T07:00:00.000Z");
  });

  it("handles the 25-hour day, when the clocks go back", () => {
    expect(ledger().nextResetAt(new Date("2026-11-01T12:00:00.000Z")).toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect(ledger().nextResetAt(new Date("2026-11-01T07:00:00.000Z")).toISOString()).toBe("2026-11-02T08:00:00.000Z");
  });

  it("handles the 23-hour day, when the clocks go forward", () => {
    expect(ledger().nextResetAt(new Date("2026-03-08T12:00:00.000Z")).toISOString()).toBe("2026-03-09T07:00:00.000Z");
    expect(ledger().nextResetAt(new Date("2026-03-08T08:00:00.000Z")).toISOString()).toBe("2026-03-09T07:00:00.000Z");
  });
});
