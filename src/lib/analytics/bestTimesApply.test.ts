import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getBestTimes } from "@/app/api/analytics/best-times/route";
import { PATCH as patchCadence } from "@/app/api/automations/cadence/route";
import { cadenceFromSuggestion } from "@/lib/analytics/bestTimesApply";
import type { AccountSlots, SlotSuggestion } from "@/lib/analytics/bestTimes";
import { updateMetrics } from "@/lib/analytics/store";
import type { PostRecord } from "@/lib/analytics/types";
import { checkCadenceInput } from "@/lib/automations/cadenceInput";
import { saveCadence } from "@/lib/automations/cadenceSave";
import { publisherConfig } from "@/lib/publisher/config";
import { DEFAULT_SLOT_TIMES, DEFAULT_WEEKEND_SLOT_TIMES } from "@/lib/publisher/slots";

const fixture = { file: "" };
vi.mock("@/lib/podcast/publicUrl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/podcast/publicUrl")>()),
  envFilePath: () => fixture.file
}));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function suggestion(dayType: SlotSuggestion["dayType"], status: SlotSuggestion["status"], times: string[]): SlotSuggestion {
  return { dayType, status, posts: 64, hours: [], current: [], times, confidence: "medium", basis: "64 posts, 8 per hour", gainPercent: 12, reason: null };
}

function account(weekday: SlotSuggestion, weekend: SlotSuggestion): AccountSlots {
  return { platform: "youtube", accountId: "youtube-primary", label: null, posts: 90, weekday, weekend };
}

beforeEach(async () => {
  fixture.file = path.join(await mkdtemp(path.join(tmpdir(), "cc-best-times-")), ".env");
  vi.stubEnv("PUBLISH_SLOT_TIMES", "");
  vi.stubEnv("PUBLISH_WEEKEND_SLOT_TIMES", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cadenceFromSuggestion", () => {
  it("proposes the weekday slots when only the weekday suggestion is ready", () => {
    const input = cadenceFromSuggestion(account(suggestion("weekday", "ready", ["09:00", "17:30"]), suggestion("weekend", "not-enough-data", WEEKEND())));
    expect(input).toEqual({ slotTimes: ["09:00", "17:30"] });
  });

  it("proposes both when both are ready", () => {
    const input = cadenceFromSuggestion(account(suggestion("weekday", "ready", ["09:00"]), suggestion("weekend", "ready", ["11:00"])));
    expect(input).toEqual({ slotTimes: ["09:00"], weekendSlotTimes: ["11:00"] });
  });

  it("proposes nothing when there is not enough data, or when the slots already match", () => {
    expect(cadenceFromSuggestion(account(suggestion("weekday", "not-enough-data", []), suggestion("weekend", "unchanged", WEEKEND())))).toBeNull();
  });

  it("only ever produces values the cadence editor accepts", () => {
    const input = cadenceFromSuggestion(account(suggestion("weekday", "ready", ["07:30", "09:00", "12:30", "15:00", "17:30", "19:00"]), suggestion("weekend", "ready", WEEKEND())));
    expect(checkCadenceInput(input)).toEqual({ ok: true, value: input });
  });
});

function WEEKEND(): string[] {
  return [...DEFAULT_WEEKEND_SLOT_TIMES];
}

describe("Use these slots writes through the cadence editor's own path", () => {
  it("saveCadence puts the suggested times in PUBLISH_SLOT_TIMES and leaves every other line alone", async () => {
    await writeFile(fixture.file, ["PUBLISH_SHORTS_PER_DAY=2", "PUBLISH_WEEKEND_SLOT_TIMES=09:00,11:30", "YOUTUBE_REFRESH_TOKEN=keep-me"].join("\n"), "utf8");
    const env: Record<string, string | undefined> = {};
    const input = cadenceFromSuggestion(account(suggestion("weekday", "ready", ["09:00", "12:30", "17:30"]), suggestion("weekend", "not-enough-data", WEEKEND())))!;

    await saveCadence(input, { file: fixture.file, env });

    const written = await readFile(fixture.file, "utf8");
    expect(written).toContain("PUBLISH_SLOT_TIMES=09:00,12:30,17:30");
    expect(written).toContain("PUBLISH_WEEKEND_SLOT_TIMES=09:00,11:30");
    expect(written).toContain("YOUTUBE_REFRESH_TOKEN=keep-me");
    expect(env).toEqual({ PUBLISH_SLOT_TIMES: "09:00,12:30,17:30" });
  });

  it("PATCH /api/automations/cadence with the suggested body changes what the publisher reads next", async () => {
    expect(publisherConfig().slotTimes).toEqual(DEFAULT_SLOT_TIMES);
    const input = cadenceFromSuggestion(account(suggestion("weekday", "ready", ["09:00", "12:30", "17:30"]), suggestion("weekend", "ready", ["11:00", "16:00"])))!;
    const response = await patchCadence(
      new NextRequest("http://localhost:3100/api/automations/cadence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", origin: "http://localhost:3100" },
        body: JSON.stringify(input)
      })
    );
    expect(response.status).toBe(200);
    expect(publisherConfig().slotTimes).toEqual(["09:00", "12:30", "17:30"]);
    expect(publisherConfig().weekendSlotTimes).toEqual(["11:00", "16:00"]);
    expect(await readFile(fixture.file, "utf8")).toContain("PUBLISH_SLOT_TIMES=09:00,12:30,17:30");
  });
});

function record(postId: string, hoursOfDay: number, dayOffset: number, views: number): PostRecord {
  const published = Date.parse("2026-08-03T00:00:00.000Z") + dayOffset * DAY + (hoursOfDay + 4) * HOUR;
  const at = new Date(published + 48 * HOUR).toISOString();
  return {
    key: `youtube:${postId}`,
    platform: "youtube",
    accountId: "youtube-primary",
    postId,
    itemId: `item-${postId}`,
    format: "video",
    title: "t",
    caption: "",
    publishedAt: new Date(published).toISOString(),
    status: "ok",
    latest: { at, metrics: { views } },
    history: [{ date: at.slice(0, 10), at, views }],
    misses: 0
  };
}

async function seedPlenty() {
  await updateMetrics((store) => {
    let n = 0;
    for (const [hour, views] of [[7, 600], [9, 4200], [10, 3000], [12, 900], [15, 1200], [17, 3600], [19, 2600], [20, 700]] as const) {
      for (let i = 0, day = 0; i < 8; day += 1) {
        if (day % 7 === 5 || day % 7 === 6) continue;
        n += 1;
        const post = record(`seed-${n}`, hour, day, views + i * 10);
        store.posts[post.key] = post;
        i += 1;
      }
    }
  });
}

describe("nothing changes without a click", () => {
  it("with too little data the route says so and still touches nothing", async () => {
    const response = await getBestTimes();
    const body = await response.json();
    expect(response.status).toBe(200);
    for (const entry of body.accounts) expect(entry.weekday.status).not.toBe("ready");
    await expect(stat(fixture.file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reading the suggestions, with plenty of data, writes no .env and moves no slot", async () => {
    await seedPlenty();
    const response = await getBestTimes();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accounts[0].weekday.status).toBe("ready");
    expect(body.current.weekday).toEqual(DEFAULT_SLOT_TIMES);

    await expect(stat(fixture.file)).rejects.toMatchObject({ code: "ENOENT" });
    expect(publisherConfig().slotTimes).toEqual(DEFAULT_SLOT_TIMES);
    expect(publisherConfig().weekendSlotTimes).toEqual(DEFAULT_WEEKEND_SLOT_TIMES);
    expect(process.env.PUBLISH_SLOT_TIMES ?? "").toBe("");
    expect((await readdir(path.dirname(fixture.file))).filter((name) => name.includes(".env"))).toEqual([]);
  });

  const lib = path.resolve(__dirname, "..");
  const read = (...parts: string[]) => readFileSync(path.resolve(lib, ...parts), "utf8");

  it("the learning, the suggestion and the read route never import the cadence writer or the .env writer", () => {
    for (const file of [
      read("analytics", "bestTimes.ts"),
      read("analytics", "bestTimesApply.ts"),
      read("analytics", "bestTimesApi.ts"),
      read("..", "app", "api", "analytics", "best-times", "route.ts")
    ]) {
      expect(file).not.toMatch(/saveCadence|writeEnvValues|envFile|cadenceSave/);
    }
  });

  it("no scheduled or startup code reaches the learning", () => {
    for (const file of [read("analytics", "schedule.ts"), read("analytics", "sync.ts"), read("..", "instrumentation.ts")]) {
      expect(file).not.toMatch(/bestTimes/);
    }
  });

  it("the Performance page sends the cadence only from the function the Use these slots control calls", () => {
    const page = readFileSync(path.resolve(lib, "..", "components", "performance", "performance-page.tsx"), "utf8");
    expect(page.match(/\/api\/automations\/cadence/g)).toHaveLength(1);
    const start = page.indexOf("const applySuggestedSlots");
    const end = page.indexOf("\n  const ", start + 10);
    expect(start).toBeGreaterThan(-1);
    expect(page.slice(start, end)).toContain("/api/automations/cadence");
    for (const chunk of page.split("useEffect(").slice(1)) {
      expect(chunk.slice(0, chunk.indexOf("\n  }, ["))).not.toContain("applySuggestedSlots");
    }
  });
});
