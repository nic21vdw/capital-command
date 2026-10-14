import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = path.resolve("scripts/health-toast.ps1");
const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-13T12:00:00.000Z");

type Lead = { id: string; title: string; source: string; score: number; url: string };

type LeadState = { lastToastAt: string | null; notifiedIds: string[] };

type Decision = {
  leads: {
    toast: { title: string; body: string; launch: string; leadIds: string[]; xml: string } | null;
    state: LeadState;
    shown: boolean;
    skipped: string | null;
  };
};

const lead = (id: string, title = `Lead ${id}`, score = 90): Lead => ({
  id,
  title,
  source: "reddit",
  score,
  url: `https://www.reddit.com/${id}`
});

let dir: string;
let counter = 0;

const statePath = () => path.join(dir, "listening-notified.json");
const stored = () => JSON.parse(readFileSync(statePath(), "utf8")) as LeadState;

function run(leads: Lead[], atHours: number, flags: string[] = ["-NoToast"]): Decision["leads"] {
  counter += 1;
  const summaryPath = path.join(dir, `leads-${counter}.json`);
  const outPath = path.join(dir, `decision-${counter}.json`);
  writeFileSync(summaryPath, JSON.stringify({ newLeads: leads.length, leads, lastScanAt: "2026-10-13T11:00:00.000Z" }), "utf8");
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      SCRIPT,
      "-SkipHealth",
      "-LeadsJson",
      summaryPath,
      "-LeadsStatePath",
      statePath(),
      "-Now",
      new Date(T0 + atHours * HOUR).toISOString(),
      "-OutFile",
      outPath,
      ...flags
    ],
    { timeout: 60_000 }
  );
  return (JSON.parse(readFileSync(outPath, "utf8")) as Decision).leads;
}

describe.skipIf(process.platform !== "win32")("health-toast.ps1 decides when to toast new leads", { timeout: 30_000 }, () => {
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "lead-toast-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("toasts the count of new leads, links to Listening, and records what it announced", () => {
    rmSync(statePath(), { force: true });

    const decision = run([lead("a", "Anyone know a structural engineering AI?"), lead("b"), lead("c")], 0);

    expect(decision.toast).toMatchObject({
      title: "3 new leads",
      launch: "http://localhost:3000/listening",
      leadIds: ["a", "b", "c"]
    });
    expect(decision.toast?.body).toContain("Anyone know a structural engineering AI?");
    expect(decision.toast?.body).toContain("2 more");
    expect(decision.toast?.body).toContain("Outreach");
    expect(stored()).toEqual({ lastToastAt: new Date(T0).toISOString(), notifiedIds: ["a", "b", "c"] });
  });

  it("says 'lead' for one", () => {
    rmSync(statePath(), { force: true });
    expect(run([lead("solo", "Only one")], 0).toast?.title).toBe("1 new lead");
  });

  it("stays quiet for two hours even when more leads arrive, then announces the ones it has not mentioned", () => {
    rmSync(statePath(), { force: true });
    run([lead("a")], 0);

    expect(run([lead("a"), lead("b")], 0.5).toast).toBeNull();
    expect(run([lead("a"), lead("b"), lead("c")], 1.9).toast).toBeNull();
    expect(stored()).toEqual({ lastToastAt: new Date(T0).toISOString(), notifiedIds: ["a"] });

    const later = run([lead("a"), lead("b"), lead("c")], 2);
    expect(later.toast?.title).toBe("2 new leads");
    expect(later.toast?.leadIds).toEqual(["b", "c"]);
    expect(stored()).toEqual({ lastToastAt: new Date(T0 + 2 * HOUR).toISOString(), notifiedIds: ["a", "b", "c"] });
  });

  it("never toasts the same lead twice", () => {
    rmSync(statePath(), { force: true });
    run([lead("a"), lead("b")], 0);

    expect(run([lead("a"), lead("b")], 5).toast).toBeNull();
    expect(run([lead("a"), lead("b")], 50).toast).toBeNull();
  });

  it("forgets a lead once it leaves the list, so the record stays small", () => {
    rmSync(statePath(), { force: true });
    run([lead("a"), lead("b")], 0);

    run([lead("b")], 1);

    expect(stored().notifiedIds).toEqual(["b"]);
  });

  it("says nothing and keeps no state of consequence when there are no leads", () => {
    rmSync(statePath(), { force: true });

    const decision = run([], 0);

    expect(decision.toast).toBeNull();
    expect(decision.state).toEqual({ lastToastAt: null, notifiedIds: [] });
  });

  it("writes nothing and shows nothing on a dry run", () => {
    rmSync(statePath(), { force: true });

    const decision = run([lead("a")], 0, ["-DryRun"]);

    expect(decision.toast?.leadIds).toEqual(["a"]);
    expect(decision.shown).toBe(false);
    expect(existsSync(statePath())).toBe(false);
  });

  it("does not record a toast it could not show, so the leads are announced when a desktop is there", () => {
    rmSync(statePath(), { force: true });

    const withoutDesktop = run([lead("a")], 0, ["-NoDesktop"]);

    expect(withoutDesktop.toast).not.toBeNull();
    expect(withoutDesktop.shown).toBe(false);
    expect(withoutDesktop.skipped).toBe("no desktop session");
    expect(stored()).toEqual({ lastToastAt: null, notifiedIds: [] });

    expect(run([lead("a")], 0.1).toast?.leadIds).toEqual(["a"]);
  });

  it("escapes lead titles so they cannot break the toast markup", () => {
    rmSync(statePath(), { force: true });

    const decision = run([lead("a", 'Need help <b>&"now"')], 0);

    expect(decision.toast?.xml).toContain("&lt;b&gt;&amp;");
    expect(decision.toast?.xml).not.toContain("<b>");
  });

  it("strips control characters from a title before it reaches the toast markup, so the markup still parses", () => {
    rmSync(statePath(), { force: true });

    const decision = run([lead("a", "Need\u0001 help\u001b with\nETABS\u007f")], 0);

    expect(decision.toast?.xml).toContain("Need help with ETABS");
    expect(decision.toast?.xml).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
    const xmlPath = path.join(dir, "toast.xml");
    writeFileSync(xmlPath, decision.toast!.xml, "utf8");
    expect(() =>
      execFileSync("powershell.exe", ["-NoProfile", "-Command", `[xml](Get-Content -Raw -LiteralPath '${xmlPath}' -Encoding UTF8) | Out-Null`], { timeout: 30_000 })
    ).not.toThrow();
  });

  it("cuts a long title on whole characters: an emoji on the cut stays whole", () => {
    rmSync(statePath(), { force: true });
    const title = `${"a".repeat(86)}\u{1F600}${"b".repeat(20)}`;

    const decision = run([lead("a", title)], 0);

    expect(decision.toast?.body).toContain(`${"a".repeat(86)}\u{1F600}...`);
    expect(decision.toast?.xml).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("leaves a title that is exactly the limit alone, emoji included", () => {
    rmSync(statePath(), { force: true });
    const title = `${"a".repeat(89)}\u{1F600}`;

    const decision = run([lead("a", title)], 0);

    expect(decision.toast?.body).toContain(title);
    expect(decision.toast?.body).not.toContain("...");
  });

  it("strips lone surrogates and the two non-characters, keeping a surrogate pair that is whole", () => {
    rmSync(statePath(), { force: true });

    const decision = run([lead("a", `Need \uD83D help \uDE00 now \uFFFE\uFFFF \u{1F600} done`)], 0);

    const markup = `${decision.toast?.xml}${decision.toast?.body}`;
    expect(markup).toContain("\u{1F600}");
    expect(markup).toContain("Need");
    expect(markup).toContain("done");
    expect(markup).not.toMatch(/[\uFFFE\uFFFF]/);
    expect(markup).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("writes nothing to the runner log on a tick that has nothing to say: no leads, or no answer from the app", () => {
    const log = path.join(dir, "runner.log");
    rmSync(log, { force: true });
    rmSync(statePath(), { force: true });

    run([], 0, ["-NoToast", "-Log", log]);
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-SkipHealth", "-BaseUrl", "http://127.0.0.1:9", "-LeadsStatePath", statePath(), "-Log", log, "-NoToast"],
      { timeout: 60_000 }
    );

    expect(existsSync(log) ? readFileSync(log, "utf8") : "").toBe("");
  });

  it("treats an unreadable state file as empty instead of failing the tick", () => {
    writeFileSync(statePath(), "{not json", "utf8");

    expect(run([lead("a")], 0).toast?.leadIds).toEqual(["a"]);
  });

  it("leaves the health toast alone: with a health file and no leads file it checks only health", () => {
    rmSync(statePath(), { force: true });
    const healthPath = path.join(dir, "health-only.json");
    const outPath = path.join(dir, "health-only-out.json");
    writeFileSync(healthPath, JSON.stringify({ ok: true, checkedAt: "x", broken: [] }), "utf8");

    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-HealthJson", healthPath, "-StatePath", path.join(dir, "h.json"), "-OutFile", outPath, "-NoToast"],
      { timeout: 60_000 }
    );

    const out = JSON.parse(readFileSync(outPath, "utf8")) as { leads: unknown };
    expect(out.leads).toBeNull();
    expect(existsSync(statePath())).toBe(false);
  });
});
