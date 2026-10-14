import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_BRAND_KIT } from "@/lib/brand/defaults";
import { brandKit, brandKitPath } from "@/lib/brand/kit";
import { mutationGuardRefuses } from "@/lib/security/mutation-guard";

const url = "http://localhost:3000/api/brand-kit";

const put = async (body: unknown, headers: Record<string, string> = {}) => {
  const { PUT } = await import("@/app/api/brand-kit/route");
  return PUT(
    new NextRequest(url, {
      method: "PUT",
      headers: { "content-type": "application/json", host: "localhost:3000", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body)
    })
  );
};

const get = async () => {
  const { GET } = await import("@/app/api/brand-kit/route");
  return GET();
};

describe("/api/brand-kit", () => {
  let dir: string;
  const previous = process.env.CAPITAL_COMMAND_DATA_DIR;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "brand-route-"));
    process.env.CAPITAL_COMMAND_DATA_DIR = dir;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.CAPITAL_COMMAND_DATA_DIR;
    else process.env.CAPITAL_COMMAND_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  it("GET returns the defaults with no overrides when nothing is saved", async () => {
    const body = await (await get()).json();
    expect(body.kit).toEqual(DEFAULT_BRAND_KIT);
    expect(body.overrides).toEqual({});
    expect(body.issues).toEqual([]);
  });

  it("PUT saves overrides atomically and GET reflects them", async () => {
    const response = await put({ overrides: { identity: { handle: "@changed" }, voice: { bannedPhrases: ["synergy"] } } });
    expect(response.status).toBe(200);
    expect(JSON.parse(readFileSync(brandKitPath(), "utf8"))).toEqual({
      identity: { handle: "@changed" },
      voice: { bannedPhrases: ["synergy"] }
    });
    const body = await (await get()).json();
    expect(body.kit.identity.handle).toBe("@changed");
    expect(body.overrides.voice.bannedPhrases).toEqual(["synergy"]);
    expect(brandKit().identity.handle).toBe("@changed");
  });

  it("PUT with empty overrides resets to the defaults", async () => {
    await put({ overrides: { identity: { handle: "@changed" } } });
    const response = await put({ overrides: {} });
    expect(response.status).toBe(200);
    expect(brandKit()).toEqual(DEFAULT_BRAND_KIT);
  });

  it("PUT refuses an invalid kit with the reasons and keeps what was saved", async () => {
    await put({ overrides: { identity: { handle: "@kept" } } });
    const response = await put({ overrides: { channels: { threads: { hashtags: { max: 999 } } } } });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.issues.join(" ")).toContain("channels.threads.hashtags.max");
    expect(brandKit().identity.handle).toBe("@kept");
  });

  it("PUT refuses a body that is not an overrides object", async () => {
    expect((await put("{ nope")).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect((await put({ overrides: [] })).status).toBe(400);
  });

  it("is covered by the origin guard", () => {
    const cross = new Request(url, { method: "PUT", headers: { host: "localhost:3000", origin: "https://evil.example", "sec-fetch-site": "cross-site" } });
    expect(mutationGuardRefuses(cross)).toBe(true);
    const local = new Request(url, { method: "PUT", headers: { host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin" } });
    expect(mutationGuardRefuses(local)).toBe(false);
  });
});
