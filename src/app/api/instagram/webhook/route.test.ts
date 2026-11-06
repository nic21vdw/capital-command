import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const queued = vi.hoisted(() => vi.fn());
vi.mock("@/lib/inbox/webhookQueue", () => ({ queueInstagramEvent: queued }));

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

describe("POST /api/instagram/webhook forged signatures", () => {
  const tampered = JSON.stringify({ object: "instagram", entry: [{ id: "forged" }] });
  const valid = () => sign(BODY);

  it.each<[string, () => Request]>([
    ["a valid signature over a different body", () => new Request("https://hooks.example/api/instagram/webhook", { method: "POST", headers: { "x-hub-signature-256": valid() }, body: tampered })],
    ["the right digest under a sha1 label", () => new Request("https://hooks.example/api/instagram/webhook", { method: "POST", headers: { "x-hub-signature-256": valid().replace("sha256=", "sha1=") }, body: BODY })],
    ["a bare digest with no label", () => new Request("https://hooks.example/api/instagram/webhook", { method: "POST", headers: { "x-hub-signature-256": valid().slice("sha256=".length) }, body: BODY })],
    ["a digest of the right length that is not hex", () => new Request("https://hooks.example/api/instagram/webhook", { method: "POST", headers: { "x-hub-signature-256": `sha256=${"z".repeat(64)}` }, body: BODY })],
    ["a valid digest with junk after it", () => new Request("https://hooks.example/api/instagram/webhook", { method: "POST", headers: { "x-hub-signature-256": `${valid()}zz` }, body: BODY })],
    ["a valid digest with one extra hex digit", () => new Request("https://hooks.example/api/instagram/webhook", { method: "POST", headers: { "x-hub-signature-256": `${valid()}a` }, body: BODY })],
    ["an empty digest", () => new Request("https://hooks.example/api/instagram/webhook", { method: "POST", headers: { "x-hub-signature-256": "sha256=" }, body: BODY })]
  ])("refuses %s with 401 and queues nothing", async (_label, build) => {
    vi.stubEnv("IG_APP_SECRET", SECRET);
    queued.mockClear();
    expect((await POST(build())).status).toBe(401);
    expect(queued).not.toHaveBeenCalled();
  });

  it("queues the event once the signature is right", async () => {
    vi.stubEnv("IG_APP_SECRET", SECRET);
    queued.mockClear();
    expect((await post({ "x-hub-signature-256": valid() })).status).toBe(200);
    expect(queued).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/instagram/webhook verification handshake", () => {
  const handshake = (token: string) =>
    GET(new Request(`https://hooks.example/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=echo`));

  it("refuses every handshake while no verify token is configured", async () => {
    expect((await handshake("")).status).toBe(403);
    expect((await handshake("anything")).status).toBe(403);
  });

  it("refuses a wrong verify token and answers the right one", async () => {
    vi.stubEnv("IG_WEBHOOK_VERIFY_TOKEN", "the-verify-token");
    expect((await handshake("wrong")).status).toBe(403);
    const ok = await handshake("the-verify-token");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("echo");
  });
});
