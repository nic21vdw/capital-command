import { describe, expect, it } from "vitest";
import type { AccountSlots, SlotSuggestion } from "@/lib/analytics/bestTimes";
import { accountOptionLabel, defaultAccountKey, slotSummaryLine, suggestionAvailable } from "@/lib/analytics/bestTimesView";

function suggestion(overrides: Partial<SlotSuggestion>): SlotSuggestion {
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
    weekday: suggestion({}),
    weekend: suggestion({ dayType: "weekend", status: "not-enough-data", reason: "Not enough data yet: 5 posts measured at 48 hours old, and 20 are needed.", confidence: null, basis: null, gainPercent: null }),
    ...overrides
  };
}

describe("slotSummaryLine", () => {
  it("lists the times with the confidence, the evidence and the expected gain", () => {
    expect(slotSummaryLine("Weekdays", suggestion({}))).toBe("Weekdays: 09:00, 17:30 (medium confidence; 64 posts, 8 per hour; about 12.5% more views at 48 hours than the current slots)");
  });

  it("leaves the gain out when it cannot be worked out", () => {
    expect(slotSummaryLine("Weekdays", suggestion({ gainPercent: null }))).toBe("Weekdays: 09:00, 17:30 (medium confidence; 64 posts, 8 per hour)");
  });

  it("says the slots already match", () => {
    expect(slotSummaryLine("Weekdays", suggestion({ status: "unchanged", gainPercent: null }))).toBe("Weekdays: the current slots already match your best hours");
  });

  it("says not enough data yet and why, and does not offer times", () => {
    const line = slotSummaryLine("Weekends", suggestion({ status: "not-enough-data", reason: "Not enough data yet: 5 posts measured at 48 hours old, and 20 are needed.", times: ["09:00"] }));
    expect(line).toBe("Weekends: not enough data yet. 5 posts measured at 48 hours old, and 20 are needed.");
  });
});

describe("suggestionAvailable", () => {
  it("is true only when at least one day type has a ready suggestion", () => {
    expect(suggestionAvailable(account())).toBe(true);
    expect(suggestionAvailable(account({ weekday: suggestion({ status: "unchanged" }) }))).toBe(false);
    expect(suggestionAvailable(account({ weekday: suggestion({ status: "not-enough-data" }) }))).toBe(false);
  });
});

describe("account helpers", () => {
  it("names an account by its label, or by platform and id", () => {
    expect(accountOptionLabel(account())).toBe("YouTube (youtube-primary)");
    expect(accountOptionLabel(account({ label: "Nic's channel" }))).toBe("YouTube: Nic's channel");
  });

  it("starts on the account with the most posts", () => {
    expect(defaultAccountKey([account({ posts: 30 }), account({ platform: "instagram", accountId: "instagram-primary", posts: 90 })])).toBe("instagram:instagram-primary");
    expect(defaultAccountKey([])).toBeNull();
  });
});
