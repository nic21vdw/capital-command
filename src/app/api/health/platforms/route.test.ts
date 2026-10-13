import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/platforms/route";
import { dataPath } from "@/lib/paths";
import { threadsFingerprint } from "@/lib/platform-health/fingerprint";
import { recordAuthFailure } from "@/lib/platform-health/store";
import { threadsConfig } from "@/lib/threads/config";
import type { PlatformHealthResponse } from "@/lib/platform-health/types";

beforeEach(async () => {
  await rm(dataPath("platform-auth.json"), { force: true });
  vi.stubEnv("THREADS_ACCESS_TOKEN", "live-token-1");
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

  it("lists a broken platform with the date it broke, why, and the fix link", async () => {
    const fingerprint = threadsFingerprint(threadsConfig().accounts);
    await recordAuthFailure("threads", "Session has expired", { now: new Date("2026-09-25T10:53:09.000Z"), fingerprint });

    const { body } = await read();

    expect(body.ok).toBe(false);
    expect(body.broken).toEqual([
      expect.objectContaining({
        platform: "threads",
        label: "Threads",
        since: "2026-09-25T10:53:09.000Z",
        reason: "Session has expired",
        fixUrl: "/settings#accounts"
      })
    ]);
  });

  it("never carries a token or the fingerprint of one", async () => {
    const fingerprint = threadsFingerprint(threadsConfig().accounts);
    await recordAuthFailure("threads", "Session has expired", { now: new Date(), fingerprint });

    const text = JSON.stringify((await read()).body);

    expect(text).not.toContain("live-token-1");
    expect(text).not.toContain(fingerprint!);
  });

  it("drops the platform as soon as its token changes", async () => {
    await recordAuthFailure("threads", "Session has expired", {
      now: new Date(),
      fingerprint: threadsFingerprint(threadsConfig().accounts)
    });
    expect((await read()).body.broken).toHaveLength(1);

    vi.stubEnv("THREADS_ACCESS_TOKEN", "live-token-2");

    expect((await read()).body).toMatchObject({ ok: true, broken: [] });
  });

  it("is never cached, so a fixed platform stops showing at once", async () => {
    const { response } = await read();

    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
