import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { MUTATION_GUARD_EXEMPT } from "@/lib/security/mutation-guard";
import { config, middleware } from "./middleware";

const API_ROOT = path.resolve(__dirname, "app/api");
const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

const CROSS_SITE = {
  host: "127.0.0.1:3000",
  origin: "https://attacker.invalid",
  "sec-fetch-site": "cross-site"
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

function exportedMutations(source: string) {
  return MUTATING_METHODS.filter((method) =>
    new RegExp(
      `export\\s+(?:async\\s+)?function\\s+${method}\\b|export\\s+(?:const|let|var)\\s+${method}\\b|export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`
    ).test(source)
  );
}

function routePath(file: string) {
  const segments = path.relative(API_ROOT, path.dirname(file)).split(path.sep).filter(Boolean);
  return ["/api", ...segments.map((segment) => segment.replace(/^\[(?:\.\.\.)?(\w+)\]$/, "sample-$1"))].join("/");
}

const mutatingRoutes = routeFiles(API_ROOT).flatMap((file) => {
  const methods = exportedMutations(readFileSync(file, "utf8"));
  return methods.length ? [{ file: path.relative(API_ROOT, file), url: routePath(file), methods }] : [];
});

function call(method: string, pathname: string, headers: Record<string, string>, base = "http://127.0.0.1:3000") {
  return middleware(new NextRequest(`${base}${pathname}`, { method, headers }));
}

function passedThrough(response: Response) {
  return response.headers.get("x-middleware-next") === "1";
}

describe("every mutating API route sits behind the cross-site guard", () => {
  it("finds the routes it is meant to cover", () => {
    expect(mutatingRoutes.length).toBeGreaterThan(60);
    expect(mutatingRoutes.map((route) => route.url)).toEqual(
      expect.arrayContaining(["/api/publish/run", "/api/publish/accounts", "/api/publish/sample-id/publish"])
    );
  });

  it("runs the guard for every path under /api", () => {
    expect(config.matcher).toEqual(["/api/:path*"]);
  });

  it("refuses a cross-site request on every route that changes something, unless it is on the allow-list", async () => {
    const wrong: string[] = [];
    for (const route of mutatingRoutes) {
      for (const method of route.methods) {
        const response = await call(method, route.url, CROSS_SITE);
        const exempt = route.url in MUTATION_GUARD_EXEMPT;
        const outcome = passedThrough(response) ? "passed" : String(response.status);
        if (exempt ? outcome !== "passed" : outcome !== "403") wrong.push(`${method} ${route.url} (${route.file}) -> ${outcome}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("allow-lists only real mutating routes, each with a stated reason", () => {
    const known = new Set(mutatingRoutes.map((route) => route.url));
    for (const [url, reason] of Object.entries(MUTATION_GUARD_EXEMPT)) {
      expect(known.has(url), `${url} is on the allow-list but is not a mutating route`).toBe(true);
      expect(reason.trim().length, `${url} needs a reason`).toBeGreaterThan(30);
    }
  });
});

describe("POST /api/publish/run", () => {
  it.each<[string, Record<string, string>]>([
    ["a foreign page with fetch metadata", CROSS_SITE],
    ["a foreign form post sent as text/plain", { ...CROSS_SITE, "content-type": "text/plain" }],
    ["a foreign origin from a browser that sends no fetch metadata", { host: "127.0.0.1:3000", origin: "https://attacker.invalid" }],
    ["an opaque origin", { host: "127.0.0.1:3000", origin: "null" }],
    ["a same-site neighbour on another port", { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3100", "sec-fetch-site": "same-site" }],
    ["a cross-site request with no Origin at all", { host: "127.0.0.1:3000", "sec-fetch-site": "cross-site" }],
    ["a DNS rebinding hostname", { host: "attacker.invalid:3000", origin: "http://attacker.invalid:3000" }]
  ])("is refused with 403 for %s", async (_label, headers) => {
    const response = await call("POST", "/api/publish/run", headers);
    expect(response.status).toBe(403);
    expect(passedThrough(response)).toBe(false);
    expect(await response.json()).toEqual({ error: "Cross-origin mutation refused." });
  });

  it.each<[string, Record<string, string>, string]>([
    ["the app on 127.0.0.1", { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" }, "http://127.0.0.1:3000"],
    ["the app on localhost", { host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }, "http://localhost:3000"],
    ["the sandbox on 3100", { host: "localhost:3100", origin: "http://localhost:3100", "sec-fetch-site": "same-origin" }, "http://localhost:3100"],
    ["the CoLateral canvas card, an iframe on 127.0.0.1:3000", { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin", "sec-fetch-dest": "iframe" }, "http://127.0.0.1:3000"],
    ["a script with no Origin and no fetch metadata (curl.exe)", { host: "localhost:3000", "content-type": "application/json" }, "http://localhost:3000"],
    ["a script that sends no headers at all", {}, "http://localhost:3000"]
  ])("passes for %s", async (_label, headers, base) => {
    const response = await call("POST", "/api/publish/run", headers, base);
    expect(passedThrough(response)).toBe(true);
  });

  it("does not guard reads", async () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(passedThrough(await call(method, "/api/publish", CROSS_SITE))).toBe(true);
    }
  });
});

describe("the allow-list", () => {
  it("covers only the exact webhook path", async () => {
    expect(passedThrough(await call("POST", "/api/instagram/webhook", CROSS_SITE))).toBe(true);
    expect((await call("POST", "/api/instagram/webhook/extra", CROSS_SITE)).status).toBe(403);
    expect((await call("POST", "/api/instagram", CROSS_SITE)).status).toBe(403);
  });
});
