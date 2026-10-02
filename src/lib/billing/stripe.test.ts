import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBillingOverview } from "./stripe";

const NOW = new Date("2026-10-02T16:00:00Z");
const secondsAgo = (days: number) => NOW.getTime() / 1000 - days * 86_400;

function charge(id: string, overrides: Record<string, unknown> = {}) {
  return { id, amount: 10_000, amount_captured: 10_000, amount_refunded: 0, currency: "usd", created: secondsAgo(1),
    status: "succeeded", paid: true, captured: true, refunded: false, ...overrides };
}

function subscription(id: string, currency = "usd", unitAmount = 1200, interval = "month", quantity = 1, intervalCount = 1) {
  return { id, status: "active", currency, items: { data: [{ quantity,
    price: { currency, unit_amount: unitAmount, recurring: { interval, interval_count: intervalCount } }
  }] } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("STRIPE_SECRET_KEY", "test-key");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function mockStripe(charges: unknown[], subscriptions: unknown[] = []) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    return new Response(JSON.stringify({ data: url.pathname.endsWith("/charges") ? charges : subscriptions, has_more: false }));
  });
}

describe("Stripe billing totals", () => {
  it("counts captured sales in the selected currency, with refunds and past-period comparison", async () => {
    mockStripe([
      charge("paid", { amount_refunded: 2000 }),
      charge("failed", { status: "failed", paid: false, amount_captured: 0 }),
      charge("pending", { status: "pending", paid: false }),
      charge("authorized", { captured: false, amount_captured: 0 }),
      charge("partial", { amount_captured: 5000 }),
      charge("cad", { currency: "cad", amount: 90_000, amount_captured: 90_000 }),
      charge("previous", { created: secondsAgo(40) })
    ]);
    const overview = await getBillingOverview("USD");
    expect(overview.source).toBe("stripe");
    expect(overview.grossVolume).toMatchObject({ amount: 150, previousAmount: 100 });
    expect(overview.netVolume).toMatchObject({ amount: 130, previousAmount: 100 });
    expect(overview.paymentBreakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Succeeded", amount: 130 }),
      expect.objectContaining({ label: "Uncaptured", amount: 100 }),
      expect.objectContaining({ label: "Failed", amount: 100 }),
      expect.objectContaining({ label: "Refunded", amount: 20 })
    ]));
    expect((await getBillingOverview("CAD")).grossVolume.amount).toBe(900);
  });

  it("builds recurring revenue from active subscriptions rather than one-time sales", async () => {
    mockStripe([charge("one-time", { amount: 99_000, amount_captured: 99_000 })], [
      subscription("monthly", "usd", 1200, "month", 2),
      subscription("annual", "usd", 12_000, "year"),
      subscription("quarterly", "usd", 3000, "month", 1, 3),
      subscription("cad", "cad", 50_000),
      { ...subscription("canceled"), status: "canceled" }
    ]);
    const overview = await getBillingOverview("USD");
    expect(overview.mrr.amount).toBe(44);
    expect(overview.activeSubscribers.amount).toBe(3);
    expect(overview.mrr.trend).toEqual([]);
  });

  it("reads later pages and places the sales chart in chronological order", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/subscriptions")) return new Response(JSON.stringify({ data: [], has_more: false }));
      const older = url.searchParams.get("starting_after") === "latest";
      return new Response(JSON.stringify({ data: [charge(older ? "older" : "latest", { created: secondsAgo(older ? 3 : 1) })], has_more: !older }));
    });
    const overview = await getBillingOverview();
    expect(overview.grossVolume.amount).toBe(200);
    expect(overview.grossVolume.trend.map((point) => point.label)).toEqual(["9/29", "10/1"]);
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).searchParams.get("starting_after") === "latest")).toBe(true);
  });

  it("retains the sample-data fallback when Stripe cannot be reached", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline"));
    expect((await getBillingOverview()).source).toBe("mock");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect((await getBillingOverview()).source).toBe("mock");
  });
});
