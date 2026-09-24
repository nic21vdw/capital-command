import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ quietFor: 901, start: vi.fn(() => ({ started: true })) }));
vi.mock("@/lib/release/status", () => ({ readReleaseStatus: async () => ({ releasable: true, pending: [{}], latestShort: "fixture" }) }));
vi.mock("@/lib/release/progress", () => ({ readReleaseProgress: async () => ({ failed: null, finished: false, quietFor: state.quietFor }) }));
vi.mock("@/lib/release/run", () => ({ isReleaseInFlight: () => true, startRelease: state.start }));
vi.mock("@/lib/release/runtime", () => ({ releaseRuntime: () => ({ instance: "fixture", running: "fixture" }) }));

beforeEach(() => { state.quietFor = 901; state.start.mockClear(); });

it("lets the retry button recover an abandoned update without restarting the server by hand", async () => {
  const { POST } = await import("@/app/api/update/route");
  expect((await POST(new Request("http://localhost:3000/api/update", {
    method: "POST", headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }
  }))).status).toBe(200);
  expect(state.start).toHaveBeenCalledWith(process.cwd(), { afterFailure: true });
});

it("still refuses another update while progress is active", async () => {
  state.quietFor = 1;
  const { POST } = await import("@/app/api/update/route");
  expect((await POST(new Request("http://localhost:3000/api/update", {
    method: "POST", headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }
  }))).status).toBe(409);
  expect(state.start).not.toHaveBeenCalled();
});


it.each(["https://attacker.invalid", "null"])("refuses %s before starting an update", async (origin) => {
  const { POST } = await import("@/app/api/update/route");
  expect((await POST(new Request("http://localhost:3000/api/update", {
    method: "POST", headers: { origin, "content-type": "text/plain" }, body: "{}"
  }))).status).toBe(403);
  expect(state.start).not.toHaveBeenCalled();
});
