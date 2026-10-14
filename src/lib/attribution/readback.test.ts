import { describe, expect, it, vi } from "vitest";
import { fetchAttributionSummary, lastDays, readbackConfig } from "@/lib/attribution/readback";

const URL_VALUE = "https://colateralai.com/api/attribution/summary";
const TOKEN = "shh-this-is-the-token";
const range = { from: "2026-10-07", to: "2026-10-13" };
const env = { COLATERAL_ATTRIBUTION_URL: URL_VALUE, COLATERAL_ATTRIBUTION_TOKEN: TOKEN };

function reply(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

describe("readbackConfig", () => {
  it("is off until both the URL and the token are set", () => {
    expect(readbackConfig({})).toBeNull();
    expect(readbackConfig({ COLATERAL_ATTRIBUTION_URL: URL_VALUE })).toBeNull();
    expect(readbackConfig({ COLATERAL_ATTRIBUTION_TOKEN: TOKEN })).toBeNull();
    expect(readbackConfig({ COLATERAL_ATTRIBUTION_URL: "  ", COLATERAL_ATTRIBUTION_TOKEN: TOKEN })).toBeNull();
  });

  it("is on when both are set", () => {
    expect(readbackConfig(env)).toEqual({ url: URL_VALUE, token: TOKEN });
  });

  it("refuses a URL that would send the token in the clear or to nowhere", () => {
    for (const url of ["http://colateralai.com/api/attribution/summary", "not a url", "https://user:pw@colateralai.com/x", "ftp://colateralai.com/x"]) {
      expect(readbackConfig({ COLATERAL_ATTRIBUTION_URL: url, COLATERAL_ATTRIBUTION_TOKEN: TOKEN })).toBeNull();
    }
  });

  it("allows plain http only for a local test server", () => {
    expect(readbackConfig({ COLATERAL_ATTRIBUTION_URL: "http://localhost:5173/api/attribution/summary", COLATERAL_ATTRIBUTION_TOKEN: TOKEN })).not.toBeNull();
  });
});

describe("lastDays", () => {
  it("returns an inclusive UTC window ending today", () => {
    expect(lastDays(7, new Date("2026-10-13T23:30:00.000Z"))).toEqual(range);
    expect(lastDays(1, new Date("2026-10-13T00:00:00.000Z"))).toEqual({ from: "2026-10-13", to: "2026-10-13" });
  });
});

describe("fetchAttributionSummary", () => {
  it("does not call out while disabled", async () => {
    const fetcher = reply({});
    expect(await fetchAttributionSummary(range, { env: {}, fetcher })).toEqual({ status: "disabled" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("asks for the window with the bearer token and returns the rows", async () => {
    const fetcher = reply({
      from: range.from,
      to: range.to,
      rows: [
        { platform: "th", code: "a3f9c2", visits: 12, buys: 2, orders: 1, revenue: { USD: 9900 } },
        { platform: "yt", code: null, visits: 40, buys: 0, orders: 0, revenue: {} }
      ]
    });
    const result = await fetchAttributionSummary(range, { env, fetcher });

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).origin + new URL(url).pathname).toBe(URL_VALUE);
    expect(new URL(url).searchParams.get("from")).toBe(range.from);
    expect(new URL(url).searchParams.get("to")).toBe(range.to);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.method ?? "GET").toBe("GET");
    expect(result).toEqual({
      status: "ok",
      summary: {
        from: range.from,
        to: range.to,
        rows: [
          { platform: "th", code: "a3f9c2", visits: 12, buys: 2, orders: 1, revenue: { USD: 9900 } },
          { platform: "yt", code: null, visits: 40, buys: 0, orders: 0, revenue: {} }
        ]
      }
    });
  });

  it("keeps only well-formed rows and counts", async () => {
    const fetcher = reply({
      rows: [
        { platform: "th", code: "a3f9c2", visits: 3, buys: 1, orders: 1, revenue: { usd: 4900, EUR: -5, XX: 10, CAD: 1.5 } },
        { platform: "myspace", code: "a3f9c2", visits: 3, buys: 0, orders: 0, revenue: {} },
        { platform: "ig", code: "BAD CODE", visits: 3, buys: 0, orders: 0, revenue: {} },
        { platform: "ig", code: "a3f9c2", visits: -1, buys: 0, orders: 0, revenue: {} },
        { platform: "ig", code: "a3f9c2", visits: "7", buys: 0, orders: 0, revenue: {} },
        "nonsense",
        null
      ]
    });
    const result = await fetchAttributionSummary(range, { env, fetcher });
    expect(result).toMatchObject({ status: "ok" });
    if (result.status !== "ok") return;
    expect(result.summary.rows).toEqual([{ platform: "th", code: "a3f9c2", visits: 3, buys: 1, orders: 1, revenue: { USD: 4900 } }]);
  });

  it("reports a CoLateral side that has not been switched on", async () => {
    const result = await fetchAttributionSummary(range, { env, fetcher: reply({ error: "not_configured" }, 503) });
    expect(result).toMatchObject({ status: "unavailable", reason: "not_enabled" });
  });

  it("reports a rejected token without echoing it", async () => {
    for (const status of [401, 403]) {
      const result = await fetchAttributionSummary(range, { env, fetcher: reply({ error: "unauthorised" }, status) });
      expect(result).toMatchObject({ status: "unavailable", reason: "unauthorised" });
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    }
  });

  it("reports other HTTP failures with the status", async () => {
    const result = await fetchAttributionSummary(range, { env, fetcher: reply({}, 500) });
    expect(result).toMatchObject({ status: "unavailable", reason: "http" });
    expect(JSON.stringify(result)).toContain("500");
  });

  it("reports a network failure without echoing the token", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED while sending Bearer ${TOKEN}`);
    });
    const result = await fetchAttributionSummary(range, { env, fetcher });
    expect(result).toMatchObject({ status: "unavailable", reason: "network" });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("rejects a body that is not a summary", async () => {
    expect(await fetchAttributionSummary(range, { env, fetcher: reply({ nope: true }) })).toMatchObject({ status: "unavailable", reason: "invalid" });
    const html = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect(await fetchAttributionSummary(range, { env, fetcher: html })).toMatchObject({ status: "unavailable", reason: "invalid" });
  });

  it("rejects a malformed window before calling out", async () => {
    const fetcher = reply({ rows: [] });
    expect(await fetchAttributionSummary({ from: "yesterday", to: range.to }, { env, fetcher })).toMatchObject({ status: "unavailable", reason: "invalid" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not follow redirects with the token attached", async () => {
    const fetcher = reply({ rows: [] });
    await fetchAttributionSummary(range, { env, fetcher });
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe("error");
  });
});
