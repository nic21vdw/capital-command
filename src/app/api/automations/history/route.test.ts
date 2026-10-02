import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/automations/history/route";

const history = vi.hoisted(() => vi.fn());
vi.mock("@/lib/automations/history", () => ({ readAutomationHistory: history }));
beforeEach(() => { history.mockReset(); history.mockResolvedValue({ events: [], total: 0 }); });

describe("automation history API", () => {
  it("passes validated filters to the journal reader", async () => {
    const response = await GET(new NextRequest("http://127.0.0.1:3198/api/automations/history?automationId=podcast&kind=retrying&page=2"));
    expect(response.status).toBe(200);
    expect(history).toHaveBeenCalledWith({ automationId: "podcast", kind: "retrying", page: 2 });
  });

  it.each(["automationId=unknown", "kind=unknown", "page=0", "page=1.5", "page=1001", "unexpected=value"])("rejects invalid history queries: %s", async (query) => {
    const response = await GET(new NextRequest(`http://127.0.0.1:3198/api/automations/history?${query}`));
    expect(response.status).toBe(400);
    expect(history).not.toHaveBeenCalled();
  });

  it("reports unavailable history without inventing zero delivery counts or leaking errors", async () => {
    history.mockRejectedValue(new Error("credential-secret"));
    const response = await GET(new NextRequest("http://127.0.0.1:3198/api/automations/history"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toContain("counts are unavailable");
    expect(JSON.stringify(body)).not.toContain("credential-secret");
    expect(body.counts).toBeUndefined();
  });
});
