import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postCode } from "@/lib/attribution/code";
import { GET } from "@/app/api/attribution/route";

vi.mock("@/lib/attribution/posts", () => ({
  attributionPostLabels: vi.fn(async () => [{ id: "threads-1", label: "The IDE should fit the way you think" }])
}));

const TOKEN = "route-test-token";

function request(query = "") {
  return new NextRequest(`http://localhost:3100/api/attribution${query}`);
}

function stubCoLateral(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("COLATERAL_ATTRIBUTION_URL", "");
  vi.stubEnv("COLATERAL_ATTRIBUTION_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/attribution", () => {
  it("says it is off, and calls nothing, until both settings exist", async () => {
    const fetchMock = stubCoLateral({});
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns labelled lines and totals for the last seven days", async () => {
    vi.stubEnv("COLATERAL_ATTRIBUTION_URL", "https://colateralai.com/api/attribution/summary");
    vi.stubEnv("COLATERAL_ATTRIBUTION_TOKEN", TOKEN);
    const fetchMock = stubCoLateral({
      rows: [
        { platform: "th", code: postCode("threads-1"), visits: 12, buys: 2, orders: 1, revenue: { USD: 9900 } },
        { platform: "yt", code: null, visits: 3, buys: 0, orders: 0, revenue: {} }
      ]
    });

    const response = await GET(request());
    const body = await response.json();

    expect(body.status).toBe("ok");
    expect(body.lines[0]).toMatchObject({ platform: "th", label: "The IDE should fit the way you think", visits: 12, buys: 2 });
    expect(body.totals).toEqual({ visits: 15, buys: 2, orders: 1, revenue: { USD: 9900 } });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const asked = new URL(url);
    const days = (Date.parse(asked.searchParams.get("to")!) - Date.parse(asked.searchParams.get("from")!)) / 86_400_000;
    expect(days).toBe(6);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("clamps the window to thirty days", async () => {
    vi.stubEnv("COLATERAL_ATTRIBUTION_URL", "https://colateralai.com/api/attribution/summary");
    vi.stubEnv("COLATERAL_ATTRIBUTION_TOKEN", TOKEN);
    const fetchMock = stubCoLateral({ rows: [] });
    await GET(request("?days=9999"));
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const asked = new URL(url);
    expect((Date.parse(asked.searchParams.get("to")!) - Date.parse(asked.searchParams.get("from")!)) / 86_400_000).toBe(29);
  });

  it("passes on that CoLateral has not switched its side on", async () => {
    vi.stubEnv("COLATERAL_ATTRIBUTION_URL", "https://colateralai.com/api/attribution/summary");
    vi.stubEnv("COLATERAL_ATTRIBUTION_TOKEN", TOKEN);
    stubCoLateral({ error: "not_configured" }, 503);
    const body = await (await GET(request())).json();
    expect(body.status).toBe("unavailable");
    expect(body.reason).toBe("not_enabled");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });
});
