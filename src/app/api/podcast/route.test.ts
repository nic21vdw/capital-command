import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/podcast/route";

describe("podcast control origin", () => {
  it.each(["save-automation", "retry-delivery", "cancel-delivery", "reschedule-delivery", "schedule-export"])("rejects cross-origin %s even with a simple text/plain request", async (action) => {
    const response = await POST(new NextRequest("http://localhost:3100/api/podcast", {
      method: "POST", headers: { origin: "https://untrusted.example", "content-type": "text/plain" }, body: JSON.stringify({ action })
    }));
    expect(response.status).toBe(403);
  });

  it.each(["http://localhost:3100", undefined])("allows same-origin or trusted local requests (%s) to reach action validation", async (origin) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (origin) headers.origin = origin;
    const response = await POST(new NextRequest("http://localhost:3100/api/podcast", { method: "POST", headers, body: JSON.stringify({ action: "unsupported" }) }));
    expect(response.status).toBe(400);
  });
});
