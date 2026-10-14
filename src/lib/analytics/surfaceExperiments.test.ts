import { describe, expect, it } from "vitest";
import type { AnalyticsReport } from "@/lib/analytics/api";
import type { AccountSlots, SlotSuggestion } from "@/lib/analytics/bestTimes";
import type { BestTimesResponse } from "@/lib/analytics/bestTimesApi";
import { platformTotals, rowsFromStore } from "@/lib/analytics/query";
import { buildPerformanceSurface } from "@/lib/analytics/surface";
import { emptyStore } from "@/lib/analytics/types";
import type { ExperimentReport } from "@/lib/experiments/evaluate";

const NOW = new Date("2026-10-20T15:00:00.000Z");
const view = { platform: "all", range: "28d", sort: "published", direction: "desc" } as const;

function report(): AnalyticsReport {
  const rows = rowsFromStore(emptyStore());
  return {
    generatedAt: NOW.toISOString(),
    sync: { lastAttemptAt: NOW.toISOString(), lastCompletedAt: NOW.toISOString(), lastResult: "ok", lastError: null, running: false, nextDueAt: null },
    accounts: [],
    posts: rows,
    totals: { last7: platformTotals(rows, 7, NOW), last28: platformTotals(rows, 28, NOW) }
  };
}

function suggestion(overrides: Partial<SlotSuggestion> = {}): SlotSuggestion {
  return {
    dayType: "weekday",
    status: "ready",
    posts: 64,
    hours: [],
    current: ["07:30", "10:00"],
    times: ["09:00", "17:30"],
    confidence: "medium",
    basis: "64 posts, 8 per hour",
    gainPercent: 12.5,
    reason: null,
    ...overrides
  };
}

function account(overrides: Partial<AccountSlots> = {}): AccountSlots {
  return {
    platform: "youtube",
    accountId: "youtube-primary",
    label: null,
    posts: 90,
    weekday: suggestion(),
    weekend: suggestion({ dayType: "weekend", status: "not-enough-data", times: ["09:00"], current: ["09:00"], confidence: null, basis: null, gainPercent: null, reason: "Not enough data yet: 5 posts measured at 48 hours old, and 20 are needed." }),
    ...overrides
  };
}

function slots(accounts: AccountSlots[]): BestTimesResponse {
  return { generatedAt: NOW.toISOString(), timeZone: "America/Toronto", ageHours: 48, accounts, current: { weekday: ["07:30", "10:00"], weekend: ["09:00"] } };
}

function experiment(overrides: Partial<ExperimentReport> = {}): ExperimentReport {
  return {
    id: "e1",
    kind: "title",
    source: { label: "Clip about agents" },
    createdAt: "2026-10-09T15:00:00.000Z",
    windowHours: 72,
    status: "decided",
    reason: "winner",
    winnerId: "A",
    summary: "Variant A won.",
    decidedAt: "2026-10-20T15:00:00.000Z",
    variants: [
      { id: "A", value: "Agents Are Eating Software", origin: "original", state: "measured", publishAt: null, publishedAt: null, windowEndsAt: null, posts: 1, measuredPosts: 1, views: 2400, viewsIndex: 2.4, rateIndex: null, score: 2.4 },
      { id: "B", value: "Why Every App Needs An Agent Now", origin: "ai", state: "measured", publishAt: null, publishedAt: null, windowEndsAt: null, posts: 1, measuredPosts: 1, views: 1000, viewsIndex: 1, rateIndex: null, score: 1 }
    ],
    ...overrides
  };
}

const base = { state: "ready" as const, report: report(), now: NOW, view, shown: 0 };

describe("the Performance surface, experiments", () => {
  it("reports how many experiments are running, decided and inconclusive, and one reading for each", () => {
    const surface = buildPerformanceSurface({
      ...base,
      experiments: { state: "ready", reports: [experiment(), experiment({ id: "e2", status: "running", reason: null, winnerId: null, summary: "0 of 2 variants have been measured over 72 hours." })] }
    });
    expect(surface.readings).toContainEqual({ label: "Experiments", value: "1 running, 1 decided, 0 inconclusive" });
    const decided = surface.readings.find((entry) => entry.label === "Title test: Clip about agents");
    expect(decided?.value).toContain("Winner");
    expect(decided?.value).toContain("Variant A won.");
    expect(decided?.value).toContain('A "Agents Are Eating Software": 2,400 views');
  });

  it("says so when there are none, and never offers a control that makes one", () => {
    const surface = buildPerformanceSurface({ ...base, experiments: { state: "ready", reports: [] } });
    expect(surface.readings).toContainEqual({ label: "Experiments", value: "No experiments yet" });
    expect(surface.controls.map((control) => control.id)).toEqual(["sync-now"]);
  });

  it("says the experiments could not be read rather than pretending there are none", () => {
    const surface = buildPerformanceSurface({ ...base, experiments: { state: "error", reports: [] } });
    expect(surface.readings).toContainEqual({ label: "Experiments", value: "Could not read the experiments" });
  });
});

describe("the Performance surface, suggested slots", () => {
  it("offers Use these slots as a destructive control, enabled only when a suggestion is ready", () => {
    const surface = buildPerformanceSurface({ ...base, slots: { state: "ready", report: slots([account()]), target: "youtube:youtube-primary", applying: false } });
    const control = surface.controls.find((entry) => entry.id === "use-slots");
    expect(control).toMatchObject({ label: "Use these slots", group: "Suggested slots", destructive: true });
    expect(control?.disabled).toBeFalsy();
    expect(control?.hint).toMatch(/\.env|posting times/i);
  });

  it("disables it, and says not enough data yet, when no account has enough history", () => {
    const thin = account({ weekday: suggestion({ status: "not-enough-data", reason: "Not enough data yet: 12 posts measured at 48 hours old, and 20 are needed.", confidence: null, basis: null, gainPercent: null }) });
    const surface = buildPerformanceSurface({ ...base, slots: { state: "ready", report: slots([thin]), target: "youtube:youtube-primary", applying: false } });
    expect(surface.controls.find((entry) => entry.id === "use-slots")?.disabled).toBe(true);
    const reading = surface.readings.find((entry) => entry.label === "Suggested slots");
    expect(reading?.value).toMatch(/not enough data yet/i);
  });

  it("disables it when the slots already match and while a write is in flight", () => {
    const same = account({ weekday: suggestion({ status: "unchanged" }), weekend: suggestion({ dayType: "weekend", status: "unchanged" }) });
    expect(
      buildPerformanceSurface({ ...base, slots: { state: "ready", report: slots([same]), target: "youtube:youtube-primary", applying: false } }).controls.find((entry) => entry.id === "use-slots")?.disabled
    ).toBe(true);
    expect(
      buildPerformanceSurface({ ...base, slots: { state: "ready", report: slots([account()]), target: "youtube:youtube-primary", applying: true } }).controls.find((entry) => entry.id === "use-slots")?.disabled
    ).toBe(true);
  });

  it("describes the selected account's suggestion with confidence and evidence, and lets an agent pick the account", () => {
    const instagram = account({ platform: "instagram", accountId: "instagram-primary", posts: 40, weekday: suggestion({ times: ["12:00", "18:00"], confidence: "low" }) });
    const surface = buildPerformanceSurface({ ...base, slots: { state: "ready", report: slots([account(), instagram]), target: "instagram:instagram-primary", applying: false } });
    const field = surface.fields.find((entry) => entry.id === "slots-account");
    expect(field).toMatchObject({ kind: "select", value: "instagram:instagram-primary", options: ["youtube:youtube-primary", "instagram:instagram-primary"] });
    const reading = surface.readings.find((entry) => entry.label === "Suggested slots");
    expect(reading?.value).toContain("Instagram (instagram-primary)");
    expect(reading?.value).toContain("12:00, 18:00");
    expect(reading?.value).toContain("low confidence");
  });

  it("has no slots field or control until the slots have been read", () => {
    const surface = buildPerformanceSurface({ ...base });
    expect(surface.fields.map((entry) => entry.id)).toEqual(["platform", "range", "sort"]);
    expect(surface.controls.map((entry) => entry.id)).toEqual(["sync-now"]);
    const loading = buildPerformanceSurface({ ...base, slots: { state: "loading", report: null, target: null, applying: false } });
    expect(loading.controls.find((entry) => entry.id === "use-slots")?.disabled).toBe(true);
  });
});
