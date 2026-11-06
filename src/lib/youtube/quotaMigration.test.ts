import { rm, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readInbox, updateInbox } from "@/lib/inbox/store";
import { emptyInbox } from "@/lib/inbox/types";
import { readListeningStore, updateListeningStore } from "@/lib/listening/store";
import { dataPath } from "@/lib/paths";
import { quotaDate } from "@/lib/publisher/quota";
import { createQuotaLedger, ledgerConfig, quotaLedgerFile, youtubeQuotaLedger } from "@/lib/youtube/quotaLedger";
import { legacyUnitsFor } from "@/lib/youtube/quotaLegacy";

const NOON = new Date("2026-10-13T19:00:00.000Z");
const TODAY = quotaDate(NOON);
const YESTERDAY = "2026-10-12";

function migrating(legacy = legacyUnitsFor) {
  return createQuotaLedger({ now: () => NOON, config: () => ledgerConfig({}), legacy });
}

async function seedOldCounters(inbox: { date: string; used: number } | null, listening: { day: string; units: number } | null) {
  await updateInbox(() => ({ ...emptyInbox(), ...(inbox ? { youtubeUnits: inbox } : {}) }));
  await updateListeningStore((store) => ({ ...store, youtube: { day: listening?.day ?? "", units: listening?.units ?? 0, cursor: 4 } }));
}

beforeEach(async () => {
  await rm(quotaLedgerFile(), { force: true });
  await seedOldCounters(null, null);
});

describe("reading the old counters", () => {
  it("returns today's inbox and Listening units and nothing for another day", async () => {
    await seedOldCounters({ date: TODAY, used: 120 }, { day: TODAY, units: 60 });
    expect(await legacyUnitsFor(TODAY)).toEqual({ inbox: 120, listening: 60 });

    await seedOldCounters({ date: YESTERDAY, used: 120 }, { day: YESTERDAY, units: 60 });
    expect(await legacyUnitsFor(TODAY)).toEqual({});
  });

  it("omits a counter that is empty", async () => {
    await seedOldCounters({ date: TODAY, used: 0 }, { day: TODAY, units: 35 });
    expect(await legacyUnitsFor(TODAY)).toEqual({ listening: 35 });
  });

  it("still reads the inbox when the Listening file is unreadable", async () => {
    await seedOldCounters({ date: TODAY, used: 90 }, null);
    await writeFile(dataPath("listening.json"), "{broken", "utf8");
    try {
      expect(await legacyUnitsFor(TODAY)).toEqual({ inbox: 90 });
    } finally {
      await rm(dataPath("listening.json"), { force: true });
    }
  });
});

describe("the first run", () => {
  it("carries today's inbox and Listening counts into the ledger", async () => {
    await seedOldCounters({ date: TODAY, used: 120 }, { day: TODAY, units: 60 });

    const state = await migrating().snapshot();

    expect(state.byPurpose).toEqual({ inbox: 120, listening: 60 });
    expect(state.nonUploadSpent).toBe(180);
    expect(state.nonUploadRemaining).toBe(120);
  });

  it("applies the carried counts before the first non-upload debit is judged", async () => {
    await seedOldCounters({ date: TODAY, used: 200 }, { day: TODAY, units: 0 });

    const quota = migrating();

    expect(await quota.debit(1, "inbox")).toMatchObject({ ok: false, reason: "budget" });
    expect(await quota.debit(100, "listening")).toMatchObject({ ok: true });
    expect((await quota.snapshot()).byPurpose).toEqual({ inbox: 200, listening: 100 });
  });

  it("keeps what an upload already spent today", async () => {
    await seedOldCounters({ date: TODAY, used: 50 }, null);
    const quota = migrating();
    await quota.debit(1600, "upload");

    expect((await quota.snapshot()).byPurpose).toEqual({ upload: 1600, inbox: 50 });
  });

  it("ignores counters from another day", async () => {
    await seedOldCounters({ date: YESTERDAY, used: 190 }, { day: YESTERDAY, units: 100 });

    expect((await migrating().snapshot()).byPurpose).toEqual({});
  });
});

describe("running it again", () => {
  it("changes nothing the second time, however many times the app restarts", async () => {
    await seedOldCounters({ date: TODAY, used: 120 }, { day: TODAY, units: 60 });

    await migrating().snapshot();
    await migrating().snapshot();
    const third = await migrating().snapshot();

    expect(third.byPurpose).toEqual({ inbox: 120, listening: 60 });
  });

  it("does not add the old count on top of what the ledger has spent since", async () => {
    await seedOldCounters({ date: TODAY, used: 120 }, { day: TODAY, units: 60 });
    await migrating().debit(10, "inbox");

    const afterRestart = migrating();
    await afterRestart.debit(5, "listening");

    expect((await afterRestart.snapshot()).byPurpose).toEqual({ inbox: 130, listening: 65 });
  });

  it("only ever raises a purpose to the old count, never lowers it", async () => {
    const quota = createQuotaLedger({ now: () => NOON, config: () => ledgerConfig({}) });
    await quota.debit(150, "inbox");

    await quota.carryOver({ inbox: 120, listening: 60 });
    await quota.carryOver({ inbox: 120, listening: 60 });

    expect((await quota.snapshot()).byPurpose).toEqual({ inbox: 150, listening: 60 });
  });

  it("does not rewrite the ledger when there is nothing to raise", async () => {
    const quota = createQuotaLedger({ now: () => NOON, config: () => ledgerConfig({}) });
    expect(await quota.carryOver({})).toBe(false);
    expect(await quota.carryOver({ inbox: 10 })).toBe(true);
    expect(await quota.carryOver({ inbox: 10 })).toBe(false);
  });
});

describe("the old fields", () => {
  it("stay readable and are no longer written", async () => {
    await seedOldCounters({ date: TODAY, used: 120 }, { day: TODAY, units: 60 });
    const quota = migrating();

    await quota.debit(1, "inbox");
    await quota.debit(50, "inbox-reply");
    await quota.debit(30, "listening");

    expect((await readInbox()).youtubeUnits).toEqual({ date: TODAY, used: 120 });
    expect((await readListeningStore()).youtube).toEqual({ day: TODAY, units: 60, cursor: 4 });
    expect((await quota.snapshot()).byPurpose).toEqual({ inbox: 121, listening: 90, "inbox-reply": 50 });
  });
});

describe("when the old stores cannot be read", () => {
  it("never delays or blocks an upload", async () => {
    const quota = migrating(async () => {
      throw new Error("inbox store is locked");
    });

    expect(await quota.debit(1600, "upload")).toEqual({ ok: true, remaining: 8_400 });
  });

  it("lets other purposes through without the carry, and carries it on a later call", async () => {
    await seedOldCounters({ date: TODAY, used: 100 }, null);
    let broken = true;
    const quota = migrating(async (day) => {
      if (broken) throw new Error("inbox store is locked");
      return legacyUnitsFor(day);
    });

    expect(await quota.debit(5, "analytics")).toMatchObject({ ok: true });
    broken = false;
    await quota.debit(1, "analytics");

    expect((await quota.snapshot()).byPurpose).toEqual({ analytics: 6, inbox: 100 });
  });
});

describe("the ledger the app uses", () => {
  it("carries today's old counts on its first use", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOON);
    try {
      await seedOldCounters({ date: TODAY, used: 80 }, { day: TODAY, units: 40 });

      const state = await youtubeQuotaLedger.snapshot();

      expect(state.byPurpose).toEqual({ inbox: 80, listening: 40 });
    } finally {
      vi.useRealTimers();
    }
  });
});
