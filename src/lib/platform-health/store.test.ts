import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { dataPath } from "@/lib/paths";
import {
  AUTH_PROBE_MINUTES,
  accountAuthBlocked,
  activeAuthStates,
  clearAuthState,
  readAuthStates,
  recordAuthFailure
} from "@/lib/platform-health/store";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const MINUTE = 60_000;
const primary = { platform: "threads" as const, accountId: "primary", accountLabel: "nic_vandewetering" };
const secondary = { platform: "threads" as const, accountId: "secondary", accountLabel: "second_handle" };

beforeEach(async () => {
  await rm(dataPath("platform-auth.json"), { force: true });
});

describe("platform auth state", () => {
  it("records the account, when it broke, why, and where to fix it", async () => {
    await recordAuthFailure(primary, "Session has expired", { now: NOW, fingerprint: "tok-a" });

    expect((await readAuthStates())["threads:primary"]).toMatchObject({
      platform: "threads",
      accountId: "primary",
      accountLabel: "nic_vandewetering",
      since: NOW.toISOString(),
      reason: "Session has expired",
      fixUrl: "/settings#accounts"
    });
  });

  it("keeps the original break date while the same credentials keep failing", async () => {
    await recordAuthFailure(primary, "first", { now: NOW, fingerprint: "tok-a" });
    const later = new Date(NOW.getTime() + 3 * 60 * MINUTE);
    await recordAuthFailure(primary, "second", { now: later, fingerprint: "tok-a" });

    expect((await readAuthStates())["threads:primary"]).toMatchObject({
      since: NOW.toISOString(),
      lastFailureAt: later.toISOString(),
      reason: "second",
      failures: 2
    });
  });

  it("starts a fresh outage when a replacement token fails too", async () => {
    await recordAuthFailure(primary, "old", { now: NOW, fingerprint: "tok-a" });
    const later = new Date(NOW.getTime() + 60 * MINUTE);
    await recordAuthFailure(primary, "new", { now: later, fingerprint: "tok-b" });

    expect((await readAuthStates())["threads:primary"]).toMatchObject({ since: later.toISOString(), failures: 1 });
  });

  it("blocks the account until the next trial call is due", async () => {
    await recordAuthFailure(primary, "x", { now: NOW, fingerprint: "tok-a" });
    const blocked = (minutes: number) =>
      accountAuthBlocked("threads", "primary", "tok-a", new Date(NOW.getTime() + minutes * MINUTE));

    expect(await blocked(1)).toBe(true);
    expect(await blocked(AUTH_PROBE_MINUTES - 1)).toBe(true);
    expect(await blocked(AUTH_PROBE_MINUTES + 1)).toBe(false);
  });

  it("keeps the state through a trial call so a failed trial pushes the next one back", async () => {
    await recordAuthFailure(primary, "x", { now: NOW, fingerprint: "tok-a" });
    const trial = new Date(NOW.getTime() + (AUTH_PROBE_MINUTES + 1) * MINUTE);
    expect(await accountAuthBlocked("threads", "primary", "tok-a", trial)).toBe(false);

    await recordAuthFailure(primary, "x", { now: trial, fingerprint: "tok-a" });

    expect(await accountAuthBlocked("threads", "primary", "tok-a", new Date(trial.getTime() + MINUTE))).toBe(true);
    expect((await readAuthStates())["threads:primary"]?.since).toBe(NOW.toISOString());
  });

  it("clears itself when the token changes", async () => {
    await recordAuthFailure(primary, "x", { now: NOW, fingerprint: "tok-a" });

    expect(await accountAuthBlocked("threads", "primary", "tok-b", new Date(NOW.getTime() + MINUTE))).toBe(false);
    expect(await readAuthStates()).toEqual({});
  });

  it("clears when a call succeeds", async () => {
    await recordAuthFailure(primary, "x", { now: NOW, fingerprint: "tok-a" });

    expect(await clearAuthState("threads", "primary")).toBe(true);
    expect(await clearAuthState("threads", "primary")).toBe(false);
    expect(await accountAuthBlocked("threads", "primary", "tok-a", NOW)).toBe(false);
  });

  it("keeps one account's break off the account next to it on the same platform", async () => {
    await recordAuthFailure(primary, "x", { now: NOW, fingerprint: "tok-a" });

    expect(await accountAuthBlocked("threads", "primary", "tok-a", NOW)).toBe(true);
    expect(await accountAuthBlocked("threads", "secondary", "tok-s", NOW)).toBe(false);

    await recordAuthFailure(secondary, "y", { now: NOW, fingerprint: "tok-s" });
    await clearAuthState("threads", "primary");

    expect(Object.keys(await readAuthStates())).toEqual(["threads:secondary"]);
  });

  it("keeps platforms independent", async () => {
    await recordAuthFailure({ platform: "instagram", accountId: "instagram-primary" }, "x", { now: NOW, fingerprint: "ig" });

    expect(await accountAuthBlocked("instagram", "instagram-primary", "ig", NOW)).toBe(true);
    expect(await accountAuthBlocked("youtube", "youtube-primary", "yt", NOW)).toBe(false);
  });

  it("treats a corrupt file as healthy instead of stopping the app", async () => {
    await mkdir(path.dirname(dataPath("platform-auth.json")), { recursive: true });
    await writeFile(dataPath("platform-auth.json"), "{not json", "utf8");

    expect(await readAuthStates()).toEqual({});
    expect(await accountAuthBlocked("threads", "primary", "tok-a", NOW)).toBe(false);
  });

  it("drops an account that no longer exists and one whose credentials changed, when listing", async () => {
    await recordAuthFailure(primary, "x", { now: NOW, fingerprint: "tok-a" });
    await recordAuthFailure(secondary, "y", { now: NOW, fingerprint: "tok-s" });
    await recordAuthFailure({ platform: "threads", accountId: "removed" }, "z", { now: NOW, fingerprint: "tok-r" });

    const fingerprints: Record<string, string | undefined> = { primary: "tok-a", secondary: "tok-new" };
    const active = await activeAuthStates(async (_platform, accountId) => fingerprints[accountId]);

    expect(active.map((state) => state.accountId)).toEqual(["primary"]);
    expect(Object.keys(await readAuthStates())).toEqual(["threads:primary"]);
  });
});
