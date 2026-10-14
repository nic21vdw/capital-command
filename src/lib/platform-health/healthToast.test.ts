import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = path.resolve("scripts/health-toast.ps1");
const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-13T12:00:00.000Z");

type Broken = {
  platform: string;
  accountId: string;
  displayName: string;
  since: string;
};

type Decision = {
  toast: { title: string; body: string; launch: string; accountKeys: string[]; xml: string } | null;
  state: Record<string, { since: string; lastToastAt: string }>;
  shown: boolean;
  skipped: string | null;
};

const threadsPrimary: Broken = {
  platform: "threads",
  accountId: "primary",
  displayName: "Threads · nic_vandewetering",
  since: "2026-09-24T20:13:48.000Z"
};
const youtubeClips: Broken = {
  platform: "youtube",
  accountId: "youtube-clips",
  displayName: "YouTube · Clips channel",
  since: "2026-10-13T11:00:00.000Z"
};

let dir: string;
let counter = 0;

const statePath = () => path.join(dir, "health-notified.json");

function run(broken: Broken[], atHours: number, flags: string[] = ["-NoToast"]): Decision {
  counter += 1;
  const healthPath = path.join(dir, `health-${counter}.json`);
  const outPath = path.join(dir, `decision-${counter}.json`);
  writeFileSync(healthPath, JSON.stringify({ ok: broken.length === 0, checkedAt: "x", broken }), "utf8");
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      SCRIPT,
      "-HealthJson",
      healthPath,
      "-StatePath",
      statePath(),
      "-Now",
      new Date(T0 + atHours * HOUR).toISOString(),
      "-OutFile",
      outPath,
      ...flags
    ],
    { timeout: 60_000 }
  );
  return JSON.parse(readFileSync(outPath, "utf8")) as Decision;
}

const stored = () => JSON.parse(readFileSync(statePath(), "utf8")) as Decision["state"];

describe.skipIf(process.platform !== "win32")("health-toast.ps1 decides when to toast", { timeout: 30_000 }, () => {
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "health-toast-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("toasts an account that has just broken, naming it, the date and where to fix it", () => {
    rmSync(statePath(), { force: true });

    const decision = run([threadsPrimary], 0);

    expect(decision.toast).toMatchObject({
      title: "Threads · nic_vandewetering has stopped posting",
      launch: "http://localhost:3000/settings#accounts",
      accountKeys: ["threads:primary"]
    });
    expect(decision.toast?.body).toContain("Sep 24, 2026");
    expect(decision.toast?.body).toContain("Settings > Accounts");
    expect(stored()["threads:primary"].lastToastAt).toBe(new Date(T0).toISOString());
  });

  it("stays quiet while the same account stays broken inside 24 hours", () => {
    expect(run([threadsPrimary], 1).toast).toBeNull();
    expect(run([threadsPrimary], 23.9).toast).toBeNull();
    expect(stored()["threads:primary"].lastToastAt).toBe(new Date(T0).toISOString());
  });

  it("reminds once 24 hours have passed, then waits another 24", () => {
    expect(run([threadsPrimary], 24).toast?.accountKeys).toEqual(["threads:primary"]);
    expect(run([threadsPrimary], 30).toast).toBeNull();
    expect(stored()["threads:primary"].lastToastAt).toBe(new Date(T0 + 24 * HOUR).toISOString());
  });

  it("toasts only the account that just broke, not the one already announced", () => {
    const decision = run([threadsPrimary, youtubeClips], 31);

    expect(decision.toast?.accountKeys).toEqual(["youtube:youtube-clips"]);
    expect(decision.toast?.title).toBe("YouTube · Clips channel has stopped posting");
    expect(Object.keys(stored()).sort()).toEqual(["threads:primary", "youtube:youtube-clips"]);
  });

  it("forgets an account that recovered, so breaking again toasts at once", () => {
    const recovered = run([youtubeClips], 32);
    expect(recovered.toast).toBeNull();
    expect(Object.keys(stored())).toEqual(["youtube:youtube-clips"]);

    const brokenAgain = run([youtubeClips, threadsPrimary], 33);

    expect(brokenAgain.toast?.accountKeys).toEqual(["threads:primary"]);
  });

  it("toasts again when the same account breaks on a new date inside the 24 hours", () => {
    const decision = run([{ ...threadsPrimary, since: "2026-10-15T00:00:00.000Z" }, youtubeClips], 34);

    expect(decision.toast?.accountKeys).toEqual(["threads:primary"]);
  });

  it("sends one toast that lists every account that broke together", () => {
    rmSync(statePath(), { force: true });

    const decision = run([threadsPrimary, youtubeClips], 0);

    expect(decision.toast?.title).toBe("2 accounts have stopped posting");
    expect(decision.toast?.accountKeys).toEqual(["threads:primary", "youtube:youtube-clips"]);
    expect(decision.toast?.body).toContain("Threads · nic_vandewetering");
    expect(decision.toast?.body).toContain("YouTube · Clips channel");
  });

  it("writes nothing and shows nothing on a dry run", () => {
    rmSync(statePath(), { force: true });

    const decision = run([threadsPrimary], 0, ["-DryRun"]);

    expect(decision.toast?.accountKeys).toEqual(["threads:primary"]);
    expect(decision.shown).toBe(false);
    expect(existsSync(statePath())).toBe(false);
  });

  it("does not record a toast it could not show, so the account is announced when a desktop is there", () => {
    rmSync(statePath(), { force: true });

    const withoutDesktop = run([threadsPrimary], 0, ["-NoDesktop"]);

    expect(withoutDesktop.toast).not.toBeNull();
    expect(withoutDesktop.shown).toBe(false);
    expect(withoutDesktop.skipped).toBe("no desktop session");
    expect(stored()).toEqual({});

    expect(run([threadsPrimary], 0.1).toast?.accountKeys).toEqual(["threads:primary"]);
  });

  it("escapes names so they cannot break the toast markup", () => {
    rmSync(statePath(), { force: true });

    const decision = run([{ ...threadsPrimary, displayName: 'Threads · <b>&"it\'s"' }], 0);

    expect(decision.toast?.xml).toContain("&lt;b&gt;&amp;");
    expect(decision.toast?.xml).not.toContain("<b>");
  });

  it("strips control characters from an account name before it reaches the toast markup", () => {
    rmSync(statePath(), { force: true });

    const decision = run([{ ...threadsPrimary, displayName: "Threads\u0001 \u001bprimary\n" }], 0);

    expect(decision.toast?.title).toContain("Threads");
    expect(decision.toast?.xml).toContain("Threads primary");
    expect(decision.toast?.xml).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
  });

  it("strips a lone surrogate and the two non-characters from an account name", () => {
    rmSync(statePath(), { force: true });

    const decision = run([{ ...threadsPrimary, displayName: `Threads \uD83D\uFFFE primary` }], 0);

    expect(decision.toast?.xml).not.toMatch(/[\uFFFE\uFFFF]/);
    expect(decision.toast?.xml).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(decision.toast?.xml).toContain("Threads");
  });

  it("treats an unreadable state file as empty instead of failing the tick", () => {
    writeFileSync(statePath(), "{not json", "utf8");

    const decision = run([threadsPrimary], 0);

    expect(decision.toast?.accountKeys).toEqual(["threads:primary"]);
  });

  it("does nothing when nothing is broken", () => {
    rmSync(statePath(), { force: true });

    const decision = run([], 0);

    expect(decision.toast).toBeNull();
    expect(stored()).toEqual({});
  });
});
