import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/platforms/route";
import { dataPath } from "@/lib/paths";
import { fingerprintOf } from "@/lib/platform-health/fingerprint";
import { recordAuthFailure } from "@/lib/platform-health/store";
import type { PlatformHealthResponse } from "@/lib/platform-health/types";

const PRIMARY = { platform: "threads" as const, accountId: "primary", accountLabel: "nic_vandewetering" };
const SECONDARY = { platform: "threads" as const, accountId: "secondary", accountLabel: "second_handle" };

beforeEach(async () => {
  await rm(dataPath("platform-auth.json"), { force: true });
  vi.stubEnv("THREADS_ACCESS_TOKEN", "live-token-1");
  vi.stubEnv("THREADS_ACCESS_TOKEN_2", "live-token-2");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function read(): Promise<{ response: Response; body: PlatformHealthResponse }> {
  const response = await GET();
  return { response, body: (await response.json()) as PlatformHealthResponse };
}

describe("GET /api/health/platforms", () => {
  it("reports every platform healthy when nothing has failed", async () => {
    const { response, body } = await read();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, broken: [] });
  });

  it("lists a broken account with the date it broke, why, and the fix link", async () => {
    await recordAuthFailure(PRIMARY, "Session has expired", {
      now: new Date("2026-09-25T10:53:09.000Z"),
      fingerprint: fingerprintOf("live-token-1")
    });

    const { body } = await read();

    expect(body.ok).toBe(false);
    expect(body.broken).toEqual([
      expect.objectContaining({
        platform: "threads",
        accountId: "primary",
        label: "Threads",
        displayName: "Threads · nic_vandewetering",
        since: "2026-09-25T10:53:09.000Z",
        reason: "Session has expired",
        fixUrl: "/settings#accounts"
      })
    ]);
  });

  it("lists only the account that broke, not the one next to it", async () => {
    await recordAuthFailure(SECONDARY, "Session has expired", { now: new Date(), fingerprint: fingerprintOf("live-token-2") });

    const { body } = await read();

    expect(body.broken.map((entry) => entry.accountId)).toEqual(["secondary"]);
  });

  it("never carries a token or the fingerprint of one", async () => {
    const fingerprint = fingerprintOf("live-token-1")!;
    await recordAuthFailure(PRIMARY, "Session has expired", { now: new Date(), fingerprint });

    const text = JSON.stringify((await read()).body);

    expect(text).not.toContain("live-token-1");
    expect(text).not.toContain(fingerprint);
  });

  it("drops the account as soon as its token changes, and keeps the other one", async () => {
    await recordAuthFailure(PRIMARY, "Session has expired", { now: new Date(), fingerprint: fingerprintOf("live-token-1") });
    await recordAuthFailure(SECONDARY, "Session has expired", { now: new Date(), fingerprint: fingerprintOf("live-token-2") });
    expect((await read()).body.broken).toHaveLength(2);

    vi.stubEnv("THREADS_ACCESS_TOKEN", "live-token-1-renewed");

    expect((await read()).body.broken.map((entry) => entry.accountId)).toEqual(["secondary"]);
  });

  it("drops an account that is no longer connected", async () => {
    await recordAuthFailure(SECONDARY, "Session has expired", { now: new Date(), fingerprint: fingerprintOf("live-token-2") });
    vi.stubEnv("THREADS_ACCESS_TOKEN_2", "");

    expect((await read()).body).toMatchObject({ ok: true, broken: [] });
  });

  it("is never cached, so a fixed platform stops showing at once", async () => {
    const { response } = await read();

    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
