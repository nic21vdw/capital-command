import { describe, expect, it, vi } from "vitest";
import { createMarketingResourceHandlers } from "./resources-http";

const request = (path = "/records", init?: RequestInit) => new Request(`http://localhost/api/integrations/marketing${path}`, init);
const owner = { ownerId: "owner-a", scopes: ["read"] };
describe("marketing passive resource boundary", () => {
  it("authenticates before resolving records or media and strips worker-only permission", async () => {
    const read = vi.fn();
    for (const identity of [null, { ownerId: "owner-a", scopes: ["worker"] }]) {
      const handlers = createMarketingResourceHandlers({ authenticate: () => identity, service: { records: read, analytics: read, media: read } });
      expect((await handlers.records(request())).status).toBe(identity ? 403 : 401);
      expect((await handlers.analytics(request("/analytics"))).status).toBe(identity ? 403 : 401);
      expect((await handlers.media(request("/media/abc"), "abc")).status).toBe(identity ? 403 : 401);
    }
    expect(read).not.toHaveBeenCalled();
  });
  it("reads only the scoped saved analytics snapshot and rejects ownership or sync query parameters", async () => {
    const analytics = vi.fn(() => ({ snapshot: "persisted_metrics", store: { state: "missing" }, totals: null }));
    const handlers = createMarketingResourceHandlers({ authenticate: () => owner, service: { analytics } });
    expect((await handlers.analytics(request("/analytics?sync=true"))).status).toBe(400);
    const response = await handlers.analytics(request("/analytics"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ totals: null });
    expect(analytics).toHaveBeenCalledExactlyOnceWith(owner);
  });
  it("passes only verified principal and exact resource id, never client owner or file arguments", async () => {
    const read = vi.fn(() => ({ project: { id: "project-1" } }));
    const handlers = createMarketingResourceHandlers({ authenticate: () => owner, service: { editor: read } });
    for (const id of ["../tokens", "a%2Fb", "a\\b", "a/b", "", "a".repeat(129)]) {
      expect((await handlers.editor(request(), id)).status).toBe(400);
    }
    expect((await handlers.editor(request("/editor/project-1?ownerId=other"), "project-1")).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
    const response = await handlers.editor(request("/editor/project-1"), "project-1");
    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledExactlyOnceWith(owner, "project-1");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("never permits a mutation through a resource read and stays closed without an installed reader", async () => {
    const read = vi.fn();
    const handlers = createMarketingResourceHandlers({ authenticate: () => owner, service: { records: read } });
    expect((await handlers.records(request("/records", { method: "POST" }))).status).toBe(405);
    expect(read).not.toHaveBeenCalled();
    expect((await handlers.editor(request(), "project-1")).status).toBe(503);
  });
  it("preserves streaming/range headers while forcing private no-store and no HEAD body", async () => {
    const media = vi.fn(() => new Response(new Uint8Array([1, 2, 3]), {
      status: 206, headers: { "Content-Range": "bytes 0-2/10", "Cache-Control": "public", "Content-Type": "video/mp4" },
    }));
    const handlers = createMarketingResourceHandlers({ authenticate: () => owner, service: { media } });
    const response = await handlers.media(request("/media/opaque", { method: "HEAD", headers: { Range: "bytes=0-2" } }), "opaque");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-2/10");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.body).toBeNull();
    expect(media).toHaveBeenCalledWith(owner, "opaque", expect.any(Request));
  });
  it("redacts failed readers without replacing unavailable records with a fake empty success", async () => {
    const handlers = createMarketingResourceHandlers({ authenticate: () => owner, service: {
      records: () => { throw new Error("secret=do-not-leak C:\\private\\file"); },
    } });
    const response = await handlers.records(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret|private\\file/);
  });
});
