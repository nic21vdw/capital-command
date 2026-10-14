import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { createQuotaLedger, ledgerConfig, quotaLedgerFile } from "@/lib/youtube/quotaLedger";

const NOON = new Date("2026-10-13T19:00:00.000Z");

function ledger(now: () => Date = () => NOON, config = ledgerConfig({})) {
  return createQuotaLedger({ now, config: () => config });
}

beforeEach(async () => {
  await rm(quotaLedgerFile(), { force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ledgerConfig", () => {
  it("defaults to 6 uploads of 1,700 units and 300 units for everything else", () => {
    expect(ledgerConfig({})).toEqual({ dailyUnits: 10_000, uploadsPerDay: 6, unitsPerUpload: 1700, nonUploadUnits: 300 });
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
  it("keeps the upload reserve out of reach: six 1,700-unit uploads do not fit in 10,000, so the reserve gives way to the 300-unit cap and no further", async () => {
    expect(await ledger().snapshot()).toMatchObject({
      dailyUnits: 10_000,
      uploadReserveConfigured: 10_200,
      uploadReserve: 9_700,
      nonUploadAllowance: 300,
      spent: 0
    });
  });

  it("shares the rest of the day between the non-upload purposes, up to the cap", async () => {
    const quota = ledger();

    expect(await quota.debit(100, "analytics")).toEqual({ ok: true, remaining: 200 });
    expect(await quota.debit(150, "inbox")).toEqual({ ok: true, remaining: 50 });
    expect(await quota.remaining("listening")).toBe(50);
    expect(await quota.debit(51, "outliers")).toMatchObject({ ok: false, reason: "non-upload-allowance", remaining: 50 });
    expect(await quota.debit(50, "listening")).toEqual({ ok: true, remaining: 0 });
    expect(await quota.debit(1, "analytics")).toMatchObject({ ok: false, remaining: 0 });
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

  it("never lets other purposes starve uploads: with the cap spent, an upload still goes through", async () => {
    const quota = ledger();
    await quota.debit(300, "listening");

    expect(await quota.debit(1, "analytics")).toMatchObject({ ok: false });
    expect(await quota.debit(1700, "upload")).toMatchObject({ ok: true, remaining: 8_000 });
    expect(await quota.remaining("upload")).toBe(8_000);
  });

  it("holds a configured reserve when the day is small enough to need it", async () => {
    const quota = ledger(() => NOON, { dailyUnits: 1000, uploadsPerDay: 2, unitsPerUpload: 300, nonUploadUnits: 300 });

    expect(await quota.snapshot()).toMatchObject({ uploadReserve: 600, uploadReserveConfigured: 600, nonUploadAllowance: 300 });
    expect(await quota.debit(300, "analytics")).toMatchObject({ ok: true });
    expect(await quota.debit(1, "analytics")).toMatchObject({ ok: false });
    expect(await quota.debit(600, "upload")).toMatchObject({ ok: true });
    expect(await quota.debit(200, "upload")).toMatchObject({ ok: false, reason: "daily-quota" });
  });

  it("refuses units that make no sense, without writing", async () => {
    const quota = ledger();

    for (const units of [0, -4, Number.NaN, 2.5]) {
      expect(await quota.debit(units, "analytics")).toMatchObject({ ok: false, reason: "invalid-units" });
    }
    await expect(readFile(quotaLedgerFile(), "utf8")).rejects.toThrow();
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

  it("grants exactly the allowance when many debits race, across two ledgers on the same file", async () => {
    const one = ledger();
    const two = ledger();

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) => (index % 2 === 0 ? one : two).debit(10, "analytics"))
    );

    expect(results.filter((result) => result.ok)).toHaveLength(30);
    expect(results.filter((result) => !result.ok && result.reason === "non-upload-allowance")).toHaveLength(20);
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

  it("says when the allowance comes back: the next midnight in Pacific time", () => {
    expect(ledger().nextResetAt(NOON).toISOString()).toBe("2026-10-14T07:00:00.000Z");
    expect(ledger().nextResetAt(new Date("2026-10-13T06:59:00.000Z")).toISOString()).toBe("2026-10-13T07:00:00.000Z");
  });

  it("refuses to spend from a ledger file it cannot read, and leaves the file alone", async () => {
    await mkdir(path.dirname(quotaLedgerFile()), { recursive: true });
    await writeFile(quotaLedgerFile(), "{ not json");
    const quota = ledger();

    expect(await quota.debit(1, "analytics")).toMatchObject({ ok: false, reason: "ledger-unreadable" });
    expect(await readFile(quotaLedgerFile(), "utf8")).toBe("{ not json");
    expect(dataPath("youtube-quota.json")).toBe(quotaLedgerFile());
  });
});
