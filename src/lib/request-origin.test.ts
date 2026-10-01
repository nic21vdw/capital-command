import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { allowsRequestOrigin } from "@/lib/request-origin";

describe("local app request origins", () => {
  it("accepts the actual loopback host despite NextURL normalizing it", () => {
    const request = new NextRequest("http://127.0.0.1:3197/api/automations", { headers: { host: "127.0.0.1:3197", origin: "http://127.0.0.1:3197" } });
    expect(request.nextUrl.hostname).toBe("localhost");
    expect(allowsRequestOrigin(request)).toBe(true);
  });

  it.each(["https://untrusted.example", "http://127.0.0.1:3000", "http://localhost:3197", "null"])("rejects a different origin: %s", (origin) => {
    const request = new NextRequest("http://127.0.0.1:3197/api/automations", { headers: { host: "127.0.0.1:3197", origin } });
    expect(allowsRequestOrigin(request)).toBe(false);
  });

  it("permits trusted CLI calls with no browser origin", () => {
    expect(allowsRequestOrigin(new NextRequest("http://localhost:3197/api/automations"))).toBe(true);
  });

  it("keeps localhost calls working without an explicit host header", () => {
    expect(allowsRequestOrigin(new NextRequest("http://localhost:3197/api/automations", { headers: { origin: "http://localhost:3197" } }))).toBe(true);
  });
});
