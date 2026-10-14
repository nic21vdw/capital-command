import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExperimentsSection } from "@/components/performance/experiments-section";
import { SuggestedSlotsCard } from "@/components/performance/suggested-slots-card";
import type { AccountSlots, SlotSuggestion } from "@/lib/analytics/bestTimes";
import type { BestTimesResponse } from "@/lib/analytics/bestTimesApi";
import type { ExperimentReport } from "@/lib/experiments/evaluate";

(globalThis as { React?: typeof React }).React = React;

function experiment(overrides: Partial<ExperimentReport>): ExperimentReport {
  return {
    id: "e1",
    kind: "title",
    source: { label: "Clip about agents" },
    createdAt: "2026-10-09T15:00:00.000Z",
    windowHours: 72,
    status: "decided",
    reason: "winner",
    winnerId: "B",
    summary: "Variant B won: it scored 2.40 against 1.00 for A.",
    decidedAt: "2026-10-20T15:00:00.000Z",
    variants: [
      { id: "A", value: "Agents Are Eating Software", origin: "original", state: "measured", publishAt: "2026-10-10T15:00:00.000Z", publishedAt: null, windowEndsAt: null, posts: 1, measuredPosts: 1, views: 1000, viewsIndex: 1, rateIndex: null, score: 1 },
      { id: "B", value: "Why Every App Needs An Agent Now", origin: "ai", state: "measured", publishAt: "2026-10-13T15:00:00.000Z", publishedAt: null, windowEndsAt: null, posts: 1, measuredPosts: 1, views: 2400, viewsIndex: 2.4, rateIndex: null, score: 2.4 }
    ],
    ...overrides
  };
}

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("ExperimentsSection", () => {
  it("lists running, decided and inconclusive experiments in their own groups", () => {
    const html = render(
      createElement(ExperimentsSection, {
        state: "ready",
        timeZone: "America/Toronto",
        reports: [
          experiment({ id: "r", status: "running", reason: null, winnerId: null, summary: "0 of 2 variants have been measured over 72 hours." }),
          experiment({ id: "d" }),
          experiment({ id: "i", status: "inconclusive", reason: "not-enough-data", winnerId: null, summary: "Not enough data: variant A reached 40 views and the minimum is 100 per variant." })
        ]
      })
    );
    expect(html).toContain("Running (1)");
    expect(html).toContain("Decided (1)");
    expect(html).toContain("Inconclusive (1)");
    expect(html).toContain("1 running, 1 decided, 1 inconclusive");
    expect(html).toContain("Not enough data: variant A reached 40 views");
    expect(html).toContain("Title test: Clip about agents");
  });

  it("marks the winning variant and shows how it compared with a typical post", () => {
    const html = render(createElement(ExperimentsSection, { state: "ready", timeZone: "America/Toronto", reports: [experiment({})] }));
    expect(html).toContain("Winner");
    expect(html).toContain("2.4x a typical post");
    expect(html).toContain("Why Every App Needs An Agent Now");
  });

  it("explains how to start one, and that nothing starts on its own, when there are none", () => {
    const html = render(createElement(ExperimentsSection, { state: "ready", timeZone: "UTC", reports: [] }));
    expect(html).toContain("No experiments yet");
    expect(html).toContain("Uploading Center");
    expect(html).toContain("Nothing is tested unless you start it");
    expect(html).not.toContain("Running (");
  });

  it("says when the experiments could not be read, rather than showing none", () => {
    const html = render(createElement(ExperimentsSection, { state: "error", timeZone: "UTC", reports: [] }));
    expect(html).toContain("could not be read");
    expect(html).not.toContain("No experiments yet");
  });
});

function suggestion(overrides: Partial<SlotSuggestion>): SlotSuggestion {
  return {
    dayType: "weekday",
    status: "ready",
    posts: 64,
    hours: [
      { hour: 9, posts: 8, meanViews: 4200, considered: true, smoothedLift: 0.62 },
      { hour: 20, posts: 8, meanViews: 700, considered: true, smoothedLift: -0.4 }
    ],
    current: ["07:30", "20:00"],
    times: ["09:00", "17:30"],
    confidence: "medium",
    basis: "64 posts, 8 per hour",
    gainPercent: 12.5,
    reason: null,
    ...overrides
  };
}

function slots(accounts: AccountSlots[]): BestTimesResponse {
  return { generatedAt: "2026-10-20T15:00:00.000Z", timeZone: "America/Toronto", ageHours: 48, accounts, current: { weekday: ["07:30", "20:00"], weekend: ["09:00", "19:00"] } };
}

function account(overrides: Partial<AccountSlots> = {}): AccountSlots {
  return {
    platform: "youtube",
    accountId: "youtube-primary",
    label: null,
    posts: 90,
    weekday: suggestion({}),
    weekend: suggestion({ dayType: "weekend", status: "not-enough-data", times: ["09:00", "19:00"], current: ["09:00", "19:00"], confidence: null, basis: null, gainPercent: null, hours: [], reason: "Not enough data yet: 5 posts measured at 48 hours old, and 20 are needed." }),
    ...overrides
  };
}

describe("SuggestedSlotsCard", () => {
  it("shows the suggested times with confidence and the evidence, and offers Use these slots", () => {
    const html = render(createElement(SuggestedSlotsCard, { state: "ready", report: slots([account()]), target: "youtube:youtube-primary", onTarget: vi.fn(), applying: false, onApply: vi.fn() }));
    expect(html).toContain("Suggested slots");
    expect(html).toContain("9:00 AM, 5:30 PM");
    expect(html).toContain("medium confidence");
    expect(html).toContain("64 posts, 8 per hour");
    expect(html).toContain("12.5% more views");
    expect(html).toContain("Use these slots");
    expect(html).toContain("Nothing changes until you press this");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Use these slots/);
  });

  it("says not enough data yet, leaves the slots as they are and cannot be pressed", () => {
    const thin = account({ weekday: suggestion({ status: "not-enough-data", reason: "Not enough data yet: 12 posts measured at 48 hours old, and 20 are needed.", confidence: null, basis: null, gainPercent: null, hours: [] }) });
    const html = render(createElement(SuggestedSlotsCard, { state: "ready", report: slots([thin]), target: "youtube:youtube-primary", onTarget: vi.fn(), applying: false, onApply: vi.fn() }));
    expect(html).toContain("Not enough data yet");
    expect(html).toContain("The slots stay as they are");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Use these slots/);
  });

  it("with no account measured yet, says the slots stay exactly as they are and shows no button", () => {
    const html = render(createElement(SuggestedSlotsCard, { state: "ready", report: slots([]), target: null, onTarget: vi.fn(), applying: false, onApply: vi.fn() }));
    expect(html).toContain("Not enough data yet");
    expect(html).toContain("stay exactly as they are");
    expect(html).toContain("7:30 AM, 8:00 PM on weekdays");
    expect(html).not.toContain("Use these slots");
  });

  it("rendering never presses the button", () => {
    const onApply = vi.fn();
    render(createElement(SuggestedSlotsCard, { state: "ready", report: slots([account()]), target: "youtube:youtube-primary", onTarget: vi.fn(), applying: false, onApply }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("lets the person pick which account the suggestion is for when there are several", () => {
    const html = render(
      createElement(SuggestedSlotsCard, {
        state: "ready",
        report: slots([account(), account({ platform: "instagram", accountId: "instagram-primary", posts: 40 })]),
        target: "youtube:youtube-primary",
        onTarget: vi.fn(),
        applying: false,
        onApply: vi.fn()
      })
    );
    expect(html).toContain("YouTube (youtube-primary)");
    expect(html).toContain("Instagram (instagram-primary)");
  });
});
