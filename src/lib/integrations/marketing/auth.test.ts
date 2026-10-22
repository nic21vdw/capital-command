import { describe, expect, it } from "vitest";
import { authenticateMarketingPrincipal, isSameOriginLoopbackMutation } from "./auth";

const request = (url = "http://127.0.0.1:3100/api/marketing", origin = "http://127.0.0.1:3100", site?: string) =>
  new Request(url, { method: "POST", headers: { origin, ...(site ? { "sec-fetch-site": site } : {}) } });

describe("marketing authentication boundary", () => {
  it("uses only the verified callback result and strips credential metadata", async () => {
    const input = new Request("http://127.0.0.1:3100", { headers: { "x-owner-id": "spoofed" } });
    expect(await authenticateMarketingPrincipal(input, () => null)).toBeNull();
    expect(await authenticateMarketingPrincipal(input, () => ({ ownerId: "owner-a", scopes: ["read", "read", "worker"], token: "synthetic-secret" })))
      .toEqual({ ownerId: "owner-a", scopes: ["read"] });
  });

  it.each([null, {}, [], { ownerId: "", scopes: ["read"] }, { ownerId: "a", scopes: ["admin"] },
    { ownerId: "a", scopes: "write" }, { ownerId: "a\n", scopes: ["read"] }, { ownerId: "a", scopes: Array(17).fill("read") }])(
    "rejects invalid principals without trusting payload data (%j)", async (principal) => {
      expect(await authenticateMarketingPrincipal(request(), () => principal)).toBeNull();
    }
  );

  it("contains authentication exceptions and gives worker no user grants", async () => {
    expect(await authenticateMarketingPrincipal(request(), () => { throw new Error("synthetic-secret"); })).toBeNull();
    expect(await authenticateMarketingPrincipal(request(), () => ({ ownerId: "owner-a", scopes: ["worker"] })))
      .toEqual({ ownerId: "owner-a", scopes: [] });
  });
});

describe("loopback origin policy", () => {
  it.each(["http://127.0.0.1:3100", "http://localhost:3100", "http://[::1]:3100", "https://localhost:3100"])(
    "allows an exact loopback origin with separate verified authentication (%s)", (origin) => {
      expect(isSameOriginLoopbackMutation(request(`${origin}/api/marketing`, origin, "same-origin"))).toBe(true);
    }
  );
  it.each([
    request(undefined, "http://127.0.0.1:3000"), request(undefined, "null"),
    request(undefined, "http://evil.example", "cross-site"), request(undefined, undefined, "same-site"),
    request("http://evil.example/api", "http://evil.example"), request("http://127.0.0.1.evil.example/api", "http://127.0.0.1.evil.example"),
    new Request("http://localhost:3100/api", { method: "POST" }),
    new Request("http://localhost:3100/api", { method: "GET", headers: { origin: "http://localhost:3100" } }),
  ])("rejects absent/cross-site origins, nonloopback hosts, and nonmutations", (input) => {
    expect(isSameOriginLoopbackMutation(input)).toBe(false);
  });
});
