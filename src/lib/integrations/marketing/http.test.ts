import { describe, expect, it, vi } from "vitest";
import { createMarketingHttpHandlers, MarketingHttpError, type MarketingHttpDependencies } from "./http";
import { isSameOriginLoopbackMutation } from "./auth";
import type { Target } from "./safety";

const base = "http://127.0.0.1:3100/api/integrations/marketing";
const target: Target = {
  ownerId: "owner-a", jobId: "job-a", revision: 2,
  artifactSha256: "a".repeat(64), payloadSha256: "b".repeat(64), caption: "Exact final caption\n#shorts",
  platform: "youtube", accountId: "account-a", visibility: "public", audience: "public",
  scheduledAt: "2026-10-20T15:00:00.000Z",
};
const source = { operation: "create_source", commandId: "command_source_0001", title: "Synthetic source", sourceUrl: "https://youtu.be/test" };
const deletion = { operation: "delete_editor_project", commandId: "10000000-0000-4000-8000-000000000001",
  target: { projectId: "project-a", jobId: "job-a", clipId: "clip-a", revision: 0, digest: "a".repeat(64), renderSignature: "1heokwo" } };
function operation(operation = "approve_job", changes = {}) { return { operation, commandId: "command_review_0001", target, ...changes }; }
function post(value: unknown, headers: Record<string, string> = {}, path = "/operations") {
  return new Request(base + path, { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:3100", ...headers }, body: typeof value === "string" ? value : JSON.stringify(value) });
}
function setup(overrides: Partial<MarketingHttpDependencies> = {}) {
  const workspace = vi.fn(() => ({ sources: [], jobs: [], liveLedgerRead: true }));
  const execute = vi.fn(() => ({ ok: true, persisted: true, commandId: "command_review_0001" }));
  const deps = {
    authenticate: vi.fn(() => ({ ownerId: "owner-a", scopes: ["read", "write", "review"] })),
    originAllowed: isSameOriginLoopbackMutation, service: { workspace, execute }, ...overrides,
  };
  return { ...createMarketingHttpHandlers(deps), service: { workspace, execute }, deps };
}
async function errorBody(response: Response) { return (await response.json()).error; }

describe("marketing HTTP request boundary", () => {
  it("forwards only the strict scoped deletion command with an authenticated write identity", async () => {
    const handler = setup();
    expect((await handler.operations(post(deletion))).status).toBe(200);
    expect(handler.service.execute).toHaveBeenCalledExactlyOnceWith({ ownerId: "owner-a", scopes: ["read", "write", "review"] }, deletion);
  });
  it.each(["read", "review", "worker"])("requires user write permission before deletion (%s)", async (scope) => {
    const handler = setup({ authenticate: () => ({ ownerId: "owner-a", scopes: [scope] }) });
    expect((await handler.operations(post(deletion))).status).toBe(403);
    expect(handler.service.execute).not.toHaveBeenCalled();
  });
  it.each([
    { ...deletion, ownerId: "owner-b" }, { ...deletion, file: "C:\\private.mp4" },
    { ...deletion, commandId: "not-a-uuid" }, { ...deletion, target: { ...deletion.target, ownerId: "owner-b" } },
    { ...deletion, target: { ...deletion.target, revision: -1 } }, { ...deletion, target: { ...deletion.target, digest: "missing" } }
  ])("refuses deletion identity/path/schema overrides: %j", async (body) => {
    const handler = setup();
    expect((await handler.operations(post(body))).status).toBe(400);
    expect(handler.service.execute).not.toHaveBeenCalled();
  });
  it("requires all security dependencies at construction", () => {
    expect(() => createMarketingHttpHandlers({} as MarketingHttpDependencies)).toThrow(TypeError);
    expect(() => createMarketingHttpHandlers({ ...setup().deps, originAllowed: undefined } as unknown as MarketingHttpDependencies)).toThrow(TypeError);
  });

  it("reads the workspace with callback-owned identity and private no-store headers", async () => {
    const handler = setup();
    const response = await handler.workspace(new Request(base + "/workspace", { headers: { "x-owner-id": "spoofed", authorization: "Bearer synthetic-secret" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(handler.service.workspace).toHaveBeenCalledWith({ ownerId: "owner-a", scopes: ["read", "write", "review"] });
    expect(await response.text()).not.toContain("synthetic-secret");
  });

  it("denies unauthenticated spoofed headers before calling services", async () => {
    const handler = setup({ authenticate: () => null });
    const response = await handler.operations(post(source, { "x-owner-id": "owner-a", "x-scopes": "write" }));
    expect(response.status).toBe(401);
    expect(handler.service.execute).not.toHaveBeenCalled();
  });

  it.each([{ scopes: [] }, { scopes: ["write"] }, { scopes: ["review"] }, { scopes: ["worker"] }])("requires explicit read scope for workspace (%j)", async ({ scopes }) => {
    const handler = setup({ authenticate: () => ({ ownerId: "owner-a", scopes }) });
    expect((await handler.workspace(new Request(base + "/workspace"))).status).toBe(403);
    expect(handler.service.workspace).not.toHaveBeenCalled();
  });

  it.each(["create_source", "request_edits", "retry_job", "approve_job"])("accepts only validated scoped user command %s", async (name) => {
    const handler = setup();
    const command = name === "create_source" ? source : operation(name, name === "request_edits" ? { instructions: "Tighten the opening." } : {});
    const response = await handler.operations(post(command));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, persisted: true });
    expect(handler.service.execute).toHaveBeenCalledExactlyOnceWith({ ownerId: "owner-a", scopes: ["read", "write", "review"] }, command);
  });

  it.each([
    ["approve_job", ["write"]], ["request_edits", ["review"]], ["retry_job", ["worker"]], ["create_source", ["read"]],
  ])("does not broaden narrow scopes for %s", async (name, scopes) => {
    const handler = setup({ authenticate: () => ({ ownerId: "owner-a", scopes }) });
    const command = name === "create_source" ? source : operation(name as string, name === "request_edits" ? { instructions: "Trim" } : {});
    expect((await handler.operations(post(command))).status).toBe(403);
    expect(handler.service.execute).not.toHaveBeenCalled();
  });

  it.each([
    { ...source, ownerId: "owner-b" }, { ...source, args: {} }, operation("record_worker_outcome", { outcome: "published" }),
    operation("approve_job", { target: { ...target, extra: "ignored?" } }),
    operation("approve_job", { target: { ...target, revision: 0 } }),
    operation("approve_job", { target: { ...target, scheduledAt: "2026-02-30T15:00:00.000Z" } }),
    operation("approve_job", { target: { ...target, scheduledAt: "2026-10-20T15:00:00Z" } }),
    operation("approve_job", { target: { ...target, payloadSha256: "b" } }),
    operation("approve_job", { target: { ...target, accountId: "" } }),
    operation("approve_job", { target: { ...target, platform: "threads" } }),
    operation("approve_job", { commandId: "short" }), operation("request_edits", { instructions: " " }),
    { ...source, sourceUrl: "http://youtu.be/test" }, { ...source, sourceUrl: "https://youtu.be@evil.example/test" },
    { ...source, sourceUrl: "https://youtu.be/test#secret" }, { ...source, sourceUrl: "https://youtu.be:8443/test" },
    null, [], { operation: "create_source", commandId: "command_source_0001" },
  ])("rejects schema drift/worker assertions instead of forwarding them (%j)", async (command) => {
    const handler = setup();
    const response = await handler.operations(post(command));
    expect(response.status).toBe(400);
    expect(handler.service.execute).not.toHaveBeenCalled();
    expect((await errorBody(response)).retryable).toBe(false);
  });

  it("refuses target owner spoofing and query-based owner overrides", async () => {
    const handler = setup();
    expect((await handler.operations(post(operation("approve_job", { target: { ...target, ownerId: "owner-b" } })))).status).toBe(403);
    expect((await handler.workspace(new Request(base + "/workspace?ownerId=owner-b"))).status).toBe(400);
    expect((await handler.operations(post(source, {}, "/operations?ownerId=owner-b"))).status).toBe(400);
    expect(handler.service.execute).not.toHaveBeenCalled();
  });

  it("requires explicit approved origin and contains transport policy exceptions", async () => {
    for (const policy of [() => false, () => { throw new Error("synthetic-secret"); }]) {
      const handler = setup({ originAllowed: policy });
      const response = await handler.operations(post(source));
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("synthetic-secret");
      expect(handler.service.execute).not.toHaveBeenCalled();
    }
    const handler = setup();
    expect((await handler.operations(post(source, { origin: "https://evil.example" }))).status).toBe(403);
  });

  it("permits a separately supplied verified transport policy without guessing grants", async () => {
    const handler = setup({ originAllowed: () => true });
    expect((await handler.operations(post(source, { origin: "https://approved.invalid" }))).status).toBe(200);
  });

  it("bounds actual streamed bytes even when Content-Length is absent or false", async () => {
    const handler = setup();
    expect((await handler.operations(post("x".repeat(1024 * 1024 + 1)))).status).toBe(413);
    expect((await handler.operations(post("x".repeat(1024 * 1024 + 1), { "content-length": "2" }))).status).toBe(413);
    expect((await handler.operations(post(source, { "content-length": String(1024 * 1024 + 1) }))).status).toBe(413);
    expect(handler.service.execute).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON, UTF-8, content types and encoded bodies", async () => {
    const handler = setup();
    expect((await handler.operations(post("{invalid"))).status).toBe(400);
    expect((await handler.operations(post(source, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await handler.operations(post(source, { "content-encoding": "gzip" }))).status).toBe(415);
    const invalidUtf8 = new Request(base, { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:3100" }, body: new Uint8Array([0xff, 0xff]) });
    expect((await handler.operations(invalidUtf8)).status).toBe(400);
    expect(handler.service.execute).not.toHaveBeenCalled();
  });

  it("enforces methods with no side effects", async () => {
    const handler = setup();
    const get = await handler.operations(new Request(base));
    const write = await handler.workspace(post(source));
    expect(get.status).toBe(405); expect(get.headers.get("allow")).toBe("POST");
    expect(write.status).toBe(405); expect(write.headers.get("allow")).toBe("GET");
    expect(handler.service.execute).not.toHaveBeenCalled();
    expect(handler.service.workspace).not.toHaveBeenCalled();
  });

  it("maps deliberately public service failures and hides arbitrary exceptions", async () => {
    const handler = setup({ service: { workspace: () => { throw new Error("synthetic-secret"); }, execute: () => { throw new MarketingHttpError(409, "stale_target", "Read the latest target."); } } });
    const workspaceResponse = await handler.workspace(new Request(base));
    expect(workspaceResponse.status).toBe(500);
    expect(await workspaceResponse.text()).not.toContain("synthetic-secret");
    const response = await handler.operations(post(operation()));
    expect(response.status).toBe(409);
    expect(await errorBody(response)).toEqual({ code: "stale_target", message: "Read the latest target.", retryable: false, outcome: "failed" });
  });

  it("marks unexpected post-dispatch/serialization failure uncertain without retries", async () => {
    for (const execute of [() => { throw new Error("synthetic-secret"); }, () => ({ unsafe: BigInt(1) })]) {
      const handler = setup({ service: { workspace: () => ({}), execute } });
      const response = await handler.operations(post(operation()));
      expect(response.status).toBe(500);
      const body = await response.text();
      expect(body).toContain('"outcome":"uncertain"');
      expect(body).toContain('"retryable":false');
      expect(body).not.toContain("synthetic-secret");
    }
  });
});
