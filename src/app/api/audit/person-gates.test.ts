import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendReply: vi.fn(),
  draftReply: vi.fn(),
  syncInbox: vi.fn(),
  runDue: vi.fn(async () => ({ posted: [] })),
  createRunFromUrl: vi.fn(),
  createRunFromSource: vi.fn(),
  updateRun: vi.fn(),
  readAppData: vi.fn(),
  writeAppData: vi.fn(),
  autoSchedule: false as boolean | "unreadable"
}));

vi.mock("@/lib/inbox/send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/inbox/send")>()),
  sendReply: mocks.sendReply
}));
vi.mock("@/lib/inbox/draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/inbox/draft")>()),
  draftReply: mocks.draftReply
}));
vi.mock("@/lib/inbox/sync", () => ({ syncInbox: mocks.syncInbox }));
vi.mock("@/lib/publisher/runner", () => ({ runDue: mocks.runDue }));
vi.mock("@/lib/publisher/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publisher/config")>();
  return { ...actual, publisherConfig: () => ({ ...actual.publisherConfig(), enabled: true }) };
});
vi.mock("@/lib/clipping/ffmpeg", () => ({ resolveFfmpeg: () => "ffmpeg", FFMPEG_MISSING_MESSAGE: "Missing" }));
vi.mock("@/lib/pipeline/runs", () => ({
  createRunFromUrl: mocks.createRunFromUrl,
  createRunFromSource: mocks.createRunFromSource,
  updateRun: mocks.updateRun,
  listRuns: vi.fn(async () => []),
  overviewContext: vi.fn(),
  runOverview: vi.fn()
}));
vi.mock("@/lib/ingest/service", () => ({ ingestOverview: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/ingest/run", () => ({ ingestLedger: vi.fn() }));
vi.mock("@/lib/storage/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/store")>()),
  readAppData: mocks.readAppData,
  writeAppData: mocks.writeAppData
}));

const FOREIGN = { origin: "https://attacker.invalid", host: "localhost:3000", "content-type": "application/json" };

function request(url: string, method: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new NextRequest(`http://localhost:3000${url}`, { method, body: JSON.stringify(body), headers });
}

type Handler = (request: NextRequest) => Promise<Response>;

const HANDLER_ORIGIN_CHECKS: Array<[string, string, () => Promise<Handler>, unknown]> = [
  ["/api/inbox/send", "POST", async () => (await import("@/app/api/inbox/send/route")).POST, { id: "youtube:a", text: "Thanks", confirm: true }],
  ["/api/inbox/draft", "POST", async () => (await import("@/app/api/inbox/draft/route")).POST, { id: "youtube:a" }],
  ["/api/inbox", "POST", async () => (await import("@/app/api/inbox/route")).POST, { action: "refresh" }],
  ["/api/inbox", "PATCH", async () => (await import("@/app/api/inbox/route")).PATCH, { id: "youtube:a", status: "done" }],
  ["/api/podcast", "POST", async () => (await import("@/app/api/podcast/route")).POST, { action: "publish" }],
  ["/api/listening", "POST", async () => (await import("@/app/api/listening/route")).POST, { action: "scan" }],
  ["/api/listening", "PATCH", async () => (await import("@/app/api/listening/route")).PATCH, { id: "x", status: "dismissed" }],
  ["/api/outreach", "POST", async () => (await import("@/app/api/outreach/route")).POST, { name: "x" }],
  ["/api/outreach", "PATCH", async () => (await import("@/app/api/outreach/route")).PATCH, { id: "x" }],
  ["/api/outreach", "DELETE", async () => (await import("@/app/api/outreach/route")).DELETE, { id: "x" }],
  ["/api/outreach/import", "POST", async () => (await import("@/app/api/outreach/import/route")).POST, { rows: [] }],
  ["/api/experiments", "POST", async () => (await import("@/app/api/experiments/route")).POST, { itemId: "x" }],
  ["/api/automations", "PATCH", async () => (await import("@/app/api/automations/route")).PATCH, { action: "overnight-scheduling", enabled: true }],
  ["/api/automations/cadence", "PATCH", async () => (await import("@/app/api/automations/cadence/route")).PATCH, { slots: [] }]
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.autoSchedule = false;
  mocks.readAppData.mockImplementation(async () => {
    if (mocks.autoSchedule === "unreadable") throw new Error("EBUSY");
    return { settings: { autoScheduleOvernight: mocks.autoSchedule } };
  });
  mocks.createRunFromUrl.mockResolvedValue({ id: "run-1" });
  mocks.createRunFromSource.mockResolvedValue({ id: "run-1" });
});

describe("routes that check the origin themselves, behind the middleware", () => {
  it.each(HANDLER_ORIGIN_CHECKS)("%s %s refuses a foreign Origin with 403 before doing anything", async (url, method, load, body) => {
    const handler = await load();
    const response = await handler(request(url, method, body, FOREIGN));
    expect(response.status).toBe(403);
    expect(mocks.sendReply).not.toHaveBeenCalled();
    expect(mocks.draftReply).not.toHaveBeenCalled();
    expect(mocks.syncInbox).not.toHaveBeenCalled();
    expect(mocks.writeAppData).not.toHaveBeenCalled();
  });
});

describe("POST /api/inbox/send needs confirm: true", () => {
  it.each<[string, unknown]>([
    ["no confirm", { id: "youtube:a", text: "Thanks" }],
    ["confirm: false", { id: "youtube:a", text: "Thanks", confirm: false }],
    ["confirm as a string", { id: "youtube:a", text: "Thanks", confirm: "true" }],
    ["confirm as 1", { id: "youtube:a", text: "Thanks", confirm: 1 }],
    ["override without confirm", { id: "youtube:a", text: "Thanks", override: true }],
    ["no body", null]
  ])("refuses %s with 400 and sends nothing", async (_label, body) => {
    const { POST } = await import("@/app/api/inbox/send/route");
    const response = await POST(request("/api/inbox/send", "POST", body));
    expect(response.status).toBe(400);
    expect(mocks.sendReply).not.toHaveBeenCalled();
  });

  it("sends on a same-origin confirmed call", async () => {
    mocks.sendReply.mockResolvedValue({ externalId: "r1", item: { id: "youtube:a" } });
    const { POST } = await import("@/app/api/inbox/send/route");
    const response = await POST(request("/api/inbox/send", "POST", { id: "youtube:a", text: "Thanks", confirm: true }, {
      origin: "http://localhost:3000",
      host: "localhost:3000",
      "content-type": "application/json"
    }));
    expect(response.status).toBe(200);
    expect(mocks.sendReply).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/pipeline books outputs only when Nic's own setting says so", () => {
  const start = async () => {
    const { POST } = await import("@/app/api/pipeline/route");
    return POST(request("/api/pipeline", "POST", { url: "https://www.youtube.com/watch?v=abc", queueWhenReady: true }));
  };
  const askedToBook = () => mocks.updateRun.mock.calls.some(([, patch]) => (patch as { queueWhenReady?: boolean }).queueWhenReady === true);

  it.each<[string, boolean | "unreadable"]>([
    ["the setting is off", false],
    ["the settings cannot be read", "unreadable"]
  ])("ignores queueWhenReady in the request when %s", async (_label, setting) => {
    mocks.autoSchedule = setting;
    expect((await start()).status).toBe(201);
    expect(askedToBook()).toBe(false);
  });

  it("books when the setting is on", async () => {
    mocks.autoSchedule = true;
    expect((await start()).status).toBe(201);
    expect(askedToBook()).toBe(true);
  });
});

describe("POST /api/publish/run never forces a post ahead of its slot", () => {
  it("ignores a force flag in the body", async () => {
    const { POST } = await import("@/app/api/publish/run/route");
    await POST(request("/api/publish/run", "POST", { force: true, platforms: ["youtube"] }));
    expect(mocks.runDue).toHaveBeenCalledTimes(1);
    expect(mocks.runDue.mock.calls[0]).toEqual([expect.any(Date), { dryRun: false }]);
  });
});

describe("POST /api/voice/tool", () => {
  const call = async (body: unknown) => {
    const { POST } = await import("@/app/api/voice/tool/route");
    return POST(request("/api/voice/tool", "POST", body));
  };

  it("refuses a call with no grant or a made-up one", async () => {
    expect((await call({ name: "start_pipeline", arguments: {} })).status).toBe(400);
    expect((await call({ grantId: "voice-grant-forged", name: "start_pipeline", arguments: {} })).status).toBe(401);
  });

  it("refuses an action tool on a session that was not armed", async () => {
    const { issueGrant } = await import("@/lib/voice/session");
    const grant = issueGrant(false);
    const body = await (await call({ grantId: grant.id, name: "start_pipeline", arguments: { url: "https://example.invalid" } })).json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/Actions are switched off/);
    expect(mocks.createRunFromUrl).not.toHaveBeenCalled();
  });

  it.each(["publish_now", "schedule_post", "delete_post", "set_token", "register_task"])(
    "has no %s tool, even on an armed session",
    async (name) => {
      const { issueGrant } = await import("@/lib/voice/session");
      const grant = issueGrant(true);
      const body = await (await call({ grantId: grant.id, name, arguments: {} })).json();
      expect(body).toEqual({ ok: false, error: `There is no tool called ${name}.` });
    }
  );
});
