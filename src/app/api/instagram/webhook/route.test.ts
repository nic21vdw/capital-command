import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const SECRET = "test-app-secret";
const BODY = JSON.stringify({ object: "instagram", entry: [] });

function sign(body: string, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function post(headers: Record<string, string> = {}) {
  return POST(new Request("https://hooks.example/api/instagram/webhook", { method: "POST", headers, body: BODY }));
}

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/instagram/webhook", () => {
  it("refuses every event when no app secret is configured", async () => {
    const response = await post({ "x-hub-signature-256": sign(BODY) });
    expect(response.status).toBe(401);
  });

  it("refuses a missing or wrong signature", async () => {
    vi.stubEnv("IG_APP_SECRET", SECRET);
    expect((await post()).status).toBe(401);
    expect((await post({ "x-hub-signature-256": sign(BODY, "another-secret") })).status).toBe(401);
  });

  it("accepts an event signed with the app secret", async () => {
    vi.stubEnv("IG_APP_SECRET", SECRET);
    expect((await post({ "x-hub-signature-256": sign(BODY) })).status).toBe(200);
  });
});
