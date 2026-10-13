import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { dataPath } from "@/lib/paths";
import {
  AUTH_PROBE_MINUTES,
  clearAuthState,
  platformAuthBlocked,
  readAuthStates,
  recordAuthFailure
} from "@/lib/platform-health/store";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const MINUTE = 60_000;

beforeEach(async () => {
  await rm(dataPath("platform-auth.json"), { force: true });
});

describe("platform auth state", () => {
  it("records the platform, when it broke, why, and where to fix it", async () => {
    await recordAuthFailure("threads", "Session has expired", { now: NOW, fingerprint: "tok-a" });

    expect((await readAuthStates()).threads).toMatchObject({
      platform: "threads",
      since: NOW.toISOString(),
      reason: "Session has expired",
      fixUrl: "/settings#accounts"
    });
  });

  it("keeps the original break date while the same credentials keep failing", async () => {
    await recordAuthFailure("threads", "first", { now: NOW, fingerprint: "tok-a" });
    const later = new Date(NOW.getTime() + 3 * 60 * MINUTE);
    await recordAuthFailure("threads", "second", { now: later, fingerprint: "tok-a" });

    expect((await readAuthStates()).threads).toMatchObject({
      since: NOW.toISOString(),
      lastFailureAt: later.toISOString(),
      reason: "second",
      failures: 2
    });
  });

  it("starts a fresh outage when a replacement token fails too", async () => {
    await recordAuthFailure("threads", "old", { now: NOW, fingerprint: "tok-a" });
    const later = new Date(NOW.getTime() + 60 * MINUTE);
    await recordAuthFailure("threads", "new", { now: later, fingerprint: "tok-b" });

    expect((await readAuthStates()).threads).toMatchObject({ since: later.toISOString(), failures: 1 });
  });

  it("blocks the platform until the next trial call is due", async () => {
    await recordAuthFailure("threads", "x", { now: NOW, fingerprint: "tok-a" });

    expect(await platformAuthBlocked("threads", "tok-a", new Date(NOW.getTime() + 1 * MINUTE))).toBe(true);
    expect(await platformAuthBlocked("threads", "tok-a", new Date(NOW.getTime() + (AUTH_PROBE_MINUTES - 1) * MINUTE))).toBe(true);
    expect(await platformAuthBlocked("threads", "tok-a", new Date(NOW.getTime() + (AUTH_PROBE_MINUTES + 1) * MINUTE))).toBe(false);
  });

  it("keeps the state through a trial call so a failed trial pushes the next one back", async () => {
    await recordAuthFailure("threads", "x", { now: NOW, fingerprint: "tok-a" });
    const trial = new Date(NOW.getTime() + (AUTH_PROBE_MINUTES + 1) * MINUTE);
    expect(await platformAuthBlocked("threads", "tok-a", trial)).toBe(false);

    await recordAuthFailure("threads", "x", { now: trial, fingerprint: "tok-a" });

    expect(await platformAuthBlocked("threads", "tok-a", new Date(trial.getTime() + MINUTE))).toBe(true);
    expect((await readAuthStates()).threads?.since).toBe(NOW.toISOString());
  });

  it("clears itself when the token changes", async () => {
    await recordAuthFailure("threads", "x", { now: NOW, fingerprint: "tok-a" });

    expect(await platformAuthBlocked("threads", "tok-b", new Date(NOW.getTime() + MINUTE))).toBe(false);
    expect(await readAuthStates()).toEqual({});
  });

  it("clears when a call succeeds", async () => {
    await recordAuthFailure("threads", "x", { now: NOW, fingerprint: "tok-a" });

    expect(await clearAuthState("threads")).toBe(true);
    expect(await clearAuthState("threads")).toBe(false);
    expect(await platformAuthBlocked("threads", "tok-a", NOW)).toBe(false);
  });

  it("tracks platforms independently", async () => {
    await recordAuthFailure("instagram", "x", { now: NOW, fingerprint: "ig" });

    expect(await platformAuthBlocked("instagram", "ig", NOW)).toBe(true);
    expect(await platformAuthBlocked("youtube", "yt", NOW)).toBe(false);
    await clearAuthState("youtube");
    expect(Object.keys(await readAuthStates())).toEqual(["instagram"]);
  });

  it("treats a corrupt file as healthy instead of stopping the app", async () => {
    await mkdir(path.dirname(dataPath("platform-auth.json")), { recursive: true });
    await writeFile(dataPath("platform-auth.json"), "{not json", "utf8");

    expect(await readAuthStates()).toEqual({});
    expect(await platformAuthBlocked("threads", "tok-a", NOW)).toBe(false);
  });
});
