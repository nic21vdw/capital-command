import { spawn } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const scripts = join(process.cwd(), "scripts");
const EM_DASH = "\u2014";
const MOJIBAKE = "\u0393\u00c7\u00f6";

type Run = { status: number | null; stdout: string; stderr: string };

const roots: string[] = [];
function tempRoot(prefix = "cc-runner-logs-"): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function run(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}): Promise<Run> {
  const capture = tempRoot("cc-run-");
  const out = openSync(join(capture, "out.txt"), "w");
  const err = openSync(join(capture, "err.txt"), "w");
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], {
    cwd: options.cwd, env: options.env ?? process.env, windowsHide: true, stdio: ["ignore", out, err]
  });
  closeSync(out);
  closeSync(err);
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill(), options.timeout ?? 60_000);
    const finish = (status: number | null) => {
      clearTimeout(timer);
      resolve({ status, stdout: readFileSync(join(capture, "out.txt"), "utf8"), stderr: readFileSync(join(capture, "err.txt"), "utf8") });
    };
    child.once("error", () => finish(null));
    child.once("exit", finish);
  });
}

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function installScripts(root: string, names: string[]): void {
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const name of names) copyFileSync(join(scripts, name), join(root, "scripts", name));
}

async function harness(body: string): Promise<string[]> {
  const root = tempRoot("cc-log-harness-");
  const file = join(root, "harness.ps1");
  writeFileSync(file, `$ErrorActionPreference = 'Stop'\n. '${join(scripts, "log-files.ps1")}'\n$dir = '${root}'\n${body}\n`);
  const result = await run(["-File", file]);
  expect(result.status, result.stderr + result.stdout).toBe(0);
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

afterEach(() => {
  while (roots.length) {
    try { rmSync(roots.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* A fixture server may still hold a handle. */ }
  }
});

describe.skipIf(process.platform !== "win32")("log files", () => {
  const newLog = `
function New-Log($folder, $name, $content, $stamp) {
  New-Item -ItemType Directory -Force -Path (Join-Path $dir $folder) | Out-Null
  $path = Join-Path (Join-Path $dir $folder) $name
  Set-Content -LiteralPath $path -Value $content -Encoding ascii
  (Get-Item -LiteralPath $path).LastWriteTime = [datetime]$stamp
  return $path
}
function Show-Names($folder) { "$folder=" + ((Get-ChildItem -LiteralPath (Join-Path $dir $folder) -File | Sort-Object Name | ForEach-Object { $_.Name }) -join '|') }
`;

  it("names an archive after the day it holds, keeping the extension last", async () => {
    const lines = await harness(`
$day = [datetime]'2026-10-13'
Split-Path -Leaf (Get-LogArchivePath -Path 'C:\\logs\\publish-runner.log' -Date $day)
Split-Path -Leaf (Get-LogArchivePath -Path 'C:\\logs\\server.out.log' -Date $day)
Split-Path -Leaf (Get-LogArchivePath -Path 'C:\\logs\\build.log' -Date $day)
`);
    expect(lines).toEqual(["publish-runner.2026-10-13.log", "server.out.2026-10-13.log", "build.2026-10-13.log"]);
  }, 30_000);

  it("rotates a log the day after it was written, and only then", async () => {
    const lines = await harness(`${newLog}
$today = [datetime]'2026-10-13 09:00'
$yesterday = New-Log 'yesterday' 'publish-runner.log' 'yesterday line' '2026-10-12 12:00'
Invoke-LogRotation -Path $yesterday -Today $today
Show-Names 'yesterday'
(Get-Content -LiteralPath (Join-Path $dir 'yesterday\\publish-runner.2026-10-12.log')) -join ''
$current = New-Log 'current' 'publish-runner.log' 'today line' '2026-10-13 07:00'
Invoke-LogRotation -Path $current -Today $today
Show-Names 'current'
$forced = New-Log 'forced' 'server.out.log' 'earlier run' '2026-10-13 07:00'
Invoke-LogRotation -Path $forced -Today $today -Always
Show-Names 'forced'
New-Item -ItemType Directory -Force -Path (Join-Path $dir 'empty') | Out-Null
$empty = Join-Path $dir 'empty\\publish-runner.log'
[System.IO.File]::WriteAllBytes($empty, [byte[]]@())
(Get-Item -LiteralPath $empty).LastWriteTime = [datetime]'2026-10-12 12:00'
Invoke-LogRotation -Path $empty -Today $today
Show-Names 'empty'
`);
    expect(lines).toEqual([
      "yesterday=publish-runner.2026-10-12.log",
      "yesterday line",
      "current=publish-runner.log",
      "forced=server.out.2026-10-13.log",
      "empty=publish-runner.log"
    ]);
  }, 30_000);

  it("adds to the day's archive instead of overwriting it when one already exists", async () => {
    const lines = await harness(`${newLog}
$archive = New-Log 'merge' 'server.out.2026-10-12.log' 'first run' '2026-10-12 09:00'
$live = New-Log 'merge' 'server.out.log' 'second run' '2026-10-12 18:00'
Invoke-LogRotation -Path $live -Today ([datetime]'2026-10-13 09:00')
Show-Names 'merge'
(Get-Content -LiteralPath $archive) -join '|'
`);
    expect(lines).toEqual(["merge=server.out.2026-10-12.log", "first run|second run"]);
  }, 30_000);

  it("keeps fourteen days of archives and deletes older ones, touching nothing else", async () => {
    const lines = await harness(`${newLog}
$live = New-Log 'keep' 'publish-runner.log' 'live' '2026-10-13 07:00'
New-Log 'keep' 'publish-runner.2026-09-28.log' 'fifteen days old' '2026-09-28 12:00' | Out-Null
New-Log 'keep' 'publish-runner.2026-09-29.log' 'fourteen days old' '2026-09-29 12:00' | Out-Null
New-Log 'keep' 'publish-runner.2026-10-12.log' 'yesterday' '2026-10-12 12:00' | Out-Null
New-Log 'keep' 'publish-runner.log.old' 'legacy and expired' '2026-09-01 12:00' | Out-Null
New-Log 'keep' 'threads-autopilot.2026-01-01.log' 'another log' '2026-01-01 12:00' | Out-Null
New-Log 'keep' 'publish-runner.2026-99-99.log' 'not a date' '2026-01-01 12:00' | Out-Null
New-Log 'keep' 'publish-runner.2026-09-01.txt' 'other extension' '2026-09-01 12:00' | Out-Null
Invoke-LogRotation -Path $live -Today ([datetime]'2026-10-13 09:00')
Show-Names 'keep'
`);
    expect(lines).toEqual([
      "keep=publish-runner.2026-09-01.txt|publish-runner.2026-09-29.log|publish-runner.2026-10-12.log|publish-runner.2026-99-99.log|publish-runner.log|threads-autopilot.2026-01-01.log"
    ]);
  }, 30_000);

  it("writes UTF-8 with no byte-order mark, however often it appends", async () => {
    const root = tempRoot();
    const log = join(root, "test.log");
    await harness(`
$path = '${log}'
Add-LogText -Path $path -Text ('first ' + [char]0x2014 + ' line')
Add-LogText -Path $path -Text ('second ' + [char]0x2192 + ' line')
`);
    const bytes = readFileSync(log);
    expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString("utf8")).toBe(`first ${EM_DASH} line\r\nsecond \u2192 line\r\n`);
    expect(bytes.includes(Buffer.from([0xe2, 0x80, 0x94]))).toBe(true);
  }, 30_000);

  it("keeps going when another process has the log open", async () => {
    const lines = await harness(`
$path = Join-Path $dir 'locked.log'
$held = [System.IO.File]::Open($path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
try { Add-LogText -Path $path -Text 'lost' } finally { $held.Dispose() }
'survived'
`);
    expect(lines).toEqual(["survived"]);
  }, 30_000);
});

const deferredDetail = `42 clips are already waiting in your TikTok inbox ${EM_DASH} open the TikTok app and post or discard them, then this one goes up on the next run.`;
const deferred = (count: number, from = 0) => Array.from({ length: count }, (_, index) => ({
  itemId: `d${String(from + index).padStart(4, "0")}`, clip: `data\\clips\\outputs\\clip-${from + index}-ready.mp4`, platform: "tiktok", outcome: "deferred", detail: deferredDetail
}));
const publishReport = (outcomes: unknown[]) => JSON.stringify({ report: { dryRun: false, now: "2026-10-13T23:49:10.609Z", queue: "C:\\data\\publish-queue.json", authChecks: [], plans: [], outcomes } });

describe.skipIf(process.platform !== "win32")("scheduled runners log a summary per tick", () => {
  let app: Server;
  let appPort = 0;
  let publishResponse = "{}";

  beforeAll(async () => {
    app = createHttpServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(request.method === "POST" && request.url === "/api/publish/run" ? publishResponse : "{}");
    });
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    appPort = (app.address() as AddressInfo).port;
  });
  afterAll(async () => { await new Promise<void>((resolve) => app.close(() => resolve())); });

  const env = () => ({ ...process.env, APP_BASE_URL: `http://127.0.0.1:${appPort}` });
  const publishTick = (root: string) => run(["-File", join(root, "scripts", "publish-runner.ps1")], { cwd: root, env: env() });
  const logText = (root: string, name: string) => readFileSync(join(root, name), "utf8");

  it("replaces an 87 KB line of 323 deferred items with a few lines, and keeps the ones that changed", async () => {
    const root = tempRoot();
    installScripts(root, ["publish-runner.ps1", "build-lock.ps1", "log-files.ps1"]);
    const failed = { itemId: "f0001", clip: "x.mp4", platform: "youtube", outcome: "failed", detail: "YouTube rejected the upload (HTTP 403)." };
    const published = { itemId: "p0001", clip: "y.mp4", platform: "instagram", outcome: "published", detail: "post 17841 is live" };
    publishResponse = publishReport([...deferred(323), published, failed]);
    expect(publishResponse.length).toBeGreaterThan(60_000);

    const first = await publishTick(root);
    expect(first.status, first.stderr + first.stdout).toBe(0);
    const bytes = readFileSync(join(root, "publish-runner.log"));
    const text = bytes.toString("utf8");
    expect(bytes.length).toBeLessThan(2_000);
    expect(text).toContain("325 outcomes: deferred 323, failed 1, published 1 - 325 changed");
    expect(text).toContain("failed f0001/youtube: YouTube rejected the upload (HTTP 403).");
    expect(text).toContain("published p0001/instagram: post 17841 is live");
    expect(text).toContain("deferred x323: 42 clips are already waiting in your TikTok inbox");
    expect(text).toContain("d0000/tiktok");
    expect(text).toContain(EM_DASH);
    expect(text).not.toContain(MOJIBAKE);
    expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);

    const lengthAfterFirst = bytes.length;
    const second = await publishTick(root);
    expect(second.status, second.stderr + second.stdout).toBe(0);
    const added = logText(root, "publish-runner.log").slice(text.length);
    expect(added.split(/\r?\n/).filter(Boolean)).toHaveLength(2);
    expect(added).toContain("325 outcomes: deferred 323, failed 1, published 1 - no change");
    expect(readFileSync(join(root, "publish-runner.log")).length - lengthAfterFirst).toBeLessThan(250);
  }, 90_000);

  it("names a clip the moment it changes state, and one that becomes blocked", async () => {
    const root = tempRoot();
    installScripts(root, ["publish-runner.ps1", "build-lock.ps1", "log-files.ps1"]);
    publishResponse = publishReport(deferred(5));
    expect((await publishTick(root)).status).toBe(0);
    const before = logText(root, "publish-runner.log");

    const [now, ...rest] = deferred(5);
    publishResponse = publishReport([
      { ...now, outcome: "published", detail: "post 99 is live" }, ...rest.slice(0, 3),
      { itemId: "n0001", clip: "z.mp4", platform: "tiktok", outcome: "deferred", detail: deferredDetail.replace("42", "41") }
    ]);
    expect((await publishTick(root)).status).toBe(0);
    const added = logText(root, "publish-runner.log").slice(before.length);
    expect(added).toContain("5 outcomes: deferred 4, published 1 - 2 changed");
    expect(added).toContain("published d0000/tiktok: post 99 is live");
    expect(added).not.toContain("d0001");
    expect(added).toContain("deferred n0001/tiktok: 41 clips are already waiting");
  }, 90_000);

  it("states a standing block again on a new day, so every day's log says what was wrong", async () => {
    const root = tempRoot();
    const state = join(root, "publish-runner.seen");
    const lines = await harness(`
$items = @(1..4 | ForEach-Object { [pscustomobject]@{ Key = "d$_/tiktok"; State = 'deferred'; Detail = 'blocked' } })
$state = '${state}'
(Get-ChangedLines -Items $items -StatePath $state -Day '2026-10-13').Count
(Get-ChangedLines -Items $items -StatePath $state -Day '2026-10-13').Count
(Get-ChangedLines -Items $items -StatePath $state -Day '2026-10-14').Count
`);
    expect(lines).toEqual(["4", "0", "4"]);
  }, 30_000);

  it("reads a response the app could not produce without failing the tick", async () => {
    const root = tempRoot();
    installScripts(root, ["publish-runner.ps1", "build-lock.ps1", "log-files.ps1"]);
    publishResponse = JSON.stringify({ skipped: true, reason: "A publish run is already in progress - leaving it alone this tick." });
    expect((await publishTick(root)).status).toBe(0);
    publishResponse = "<html>Bad gateway</html>";
    expect((await publishTick(root)).status).toBe(0);
    const text = logText(root, "publish-runner.log");
    expect(text).toContain("skipped: A publish run is already in progress");
    expect(text).toContain(`no usable response from the app (${publishResponse.length} characters): <html>Bad gateway</html>`);
  }, 90_000);

  it("logs one line per Threads tick plus the slots that changed", async () => {
    const root = tempRoot();
    installScripts(root, ["threads-autopilot.ps1", "build-lock.ps1", "log-files.ps1"]);
    const output = (stamp: string, trace: string) => [
      "[threads] plan (2026-10-13): Today's batch is already scheduled.",
      `[threads]   slot 2 primary \u2192 failed ${EM_DASH} Threads profile (nic) failed (HTTP 401): {"error":{"message":"Error validating access token: Session has expired on Thursday, 24-Sep-26 20:13:48 PDT. The current time is ${stamp}.","fbtrace_id":"${trace}"}}`,
      "[threads] posted 0, failed 1, skipped 0"
    ].join("\n");
    const replay = join(root, "replay.txt");
    const tick = () => run(["-File", join(root, "scripts", "threads-autopilot.ps1"), "-ReplayFile", replay], { cwd: root, env: env() });

    writeFileSync(replay, output("Tuesday, 13-Oct-26 16:43:05 PDT", "AQ_GDnwsfG52XXh79MQTeBp"), "utf8");
    expect((await tick()).status).toBe(0);
    const first = logText(root, "threads-autopilot.log");
    expect(first).toContain("posted 0, failed 1, skipped 0 - 2 changed");
    expect(first).toContain("failed slot 2 primary: Threads profile (nic) failed (HTTP 401)");
    expect(first).toContain("  [threads] plan (2026-10-13): Today's batch is already scheduled.");

    writeFileSync(replay, output("Tuesday, 13-Oct-26 16:48:05 PDT", "AXy7QqkLp0aRtZb1cDeFgH"), "utf8");
    expect((await tick()).status).toBe(0);
    const added = logText(root, "threads-autopilot.log").slice(first.length);
    expect(added.split(/\r?\n/).filter(Boolean)).toHaveLength(2);
    expect(added).toContain("posted 0, failed 1, skipped 0 - no change");
    expect(logText(root, "threads-autopilot.log")).not.toContain(MOJIBAKE);
  }, 90_000);

  it("starts neither runner's server with npm, so there is nothing a stop script cannot find", () => {
    for (const name of ["publish-runner.ps1", "threads-autopilot.ps1"]) {
      const source = readFileSync(join(scripts, name), "utf8");
      expect(source, name).not.toContain("npm.cmd");
      expect(source, name).toMatch(/start-server\.ps1"\)\s+-Quiet -NoBuild/);
    }
  });
});

function writeFixtureNext(root: string): void {
  mkdirSync(join(root, "node_modules", "next", "dist", "bin"), { recursive: true });
  writeFileSync(join(root, "node_modules", "next", "dist", "bin", "next"), `
    const http = require('node:http');
    const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
    const report = JSON.stringify({ report: { dryRun: false, now: 'x', queue: 'q', authChecks: [], plans: [], outcomes: [
      { itemId: 'live1', clip: 'a.mp4', platform: 'youtube', outcome: 'published', detail: 'served by the fixture ${EM_DASH} ok' }
    ] } });
    http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(req.method === 'POST' ? report : '{}');
    }).listen(port, '127.0.0.1', () => console.log('fixture server listening ${EM_DASH} ready'));
  `);
}

function killFixtureServer(root: string): void {
  try { process.kill(Number(readFileSync(join(root, "server.pid"), "utf8").trim())); } catch { /* Already stopped. */ }
}

describe.skipIf(process.platform !== "win32")("the runners start the app through start-server.ps1", () => {
  const files = ["publish-runner.ps1", "build-lock.ps1", "log-files.ps1", "start-server.ps1", "stop-server.ps1", "wait-for-url.ps1"];

  it("leaves a server.pid that stop-server.ps1 can act on, and logs the server's output", async () => {
    const root = tempRoot();
    installScripts(root, files);
    mkdirSync(join(root, ".next"), { recursive: true });
    writeFileSync(join(root, ".next", "BUILD_ID"), "fixture-build");
    writeFixtureNext(root);
    const port = await freePort();
    const env = { ...process.env, CAPITAL_COMMAND_PORT: String(port), APP_BASE_URL: `http://127.0.0.1:${port}`, node: process.execPath };
    try {
      const tick = await run(["-File", join(root, "scripts", "publish-runner.ps1")], { cwd: root, env, timeout: 120_000 });
      expect(tick.status, tick.stderr + tick.stdout).toBe(0);
      const pid = Number(readFileSync(join(root, "server.pid"), "utf8").trim());
      expect(pid).toBeGreaterThan(0);
      expect(() => process.kill(pid, 0)).not.toThrow();
      const log = readFileSync(join(root, "publish-runner.log"), "utf8");
      expect(log).toContain(`App not running at http://127.0.0.1:${port} - starting it.`);
      expect(log).toContain(`Started server with PID ${pid}`);
      expect(log).toContain(`published live1/youtube: served by the fixture ${EM_DASH} ok`);
      expect(readFileSync(join(root, "server.out.log"), "utf8")).toContain(`fixture server listening ${EM_DASH} ready`);

      const stop = await run(["-File", join(root, "scripts", "stop-server.ps1")], { cwd: root, env, timeout: 60_000 });
      expect(stop.status, stop.stderr + stop.stdout).toBe(0);
      expect(stop.stdout).toContain(`Stopped server PID(s): ${pid}`);
      expect(existsSync(join(root, "server.pid"))).toBe(false);
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      killFixtureServer(root);
    }
  }, 180_000);

  it("does not build when the runner starts the app, and says so", async () => {
    const root = tempRoot();
    installScripts(root, files);
    mkdirSync(join(root, ".next"), { recursive: true });
    writeFileSync(join(root, ".next", "BUILD_ID"), "fixture-build");
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", scripts: { build: "node -e \"require('fs').writeFileSync('built.txt','1')\"" } }));
    writeFixtureNext(root);
    const port = await freePort();
    const env = { ...process.env, CAPITAL_COMMAND_PORT: String(port), node: process.execPath };
    try {
      const result = await run(["-File", join(root, "scripts", "start-server.ps1"), "-Quiet", "-NoBuild"], { cwd: root, env, timeout: 120_000 });
      expect(result.status, result.stderr + result.stdout).toBe(0);
      expect(result.stdout).toContain("without rebuilding");
      expect(existsSync(join(root, "built.txt"))).toBe(false);
      expect(existsSync(join(root, "build.log"))).toBe(false);
      expect(existsSync(join(root, "server.pid"))).toBe(true);
    } finally {
      killFixtureServer(root);
    }
  }, 180_000);

  it("archives yesterday's logs when it starts and writes build.log as UTF-8", async () => {
    const root = tempRoot();
    installScripts(root, files);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", scripts: { build: "node build.js" } }));
    writeFileSync(join(root, "build.js"), `
      require('fs').mkdirSync('.next', { recursive: true });
      require('fs').writeFileSync('.next/BUILD_ID', 'fixture-build');
      console.log('Compiled successfully ${EM_DASH} 42 routes');
    `);
    writeFixtureNext(root);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    for (const name of ["server.out.log", "server.err.log", "build.log"]) {
      writeFileSync(join(root, name), `previous ${name}\n`);
      utimesSync(join(root, name), threeDaysAgo, threeDaysAgo);
    }
    const port = await freePort();
    const env = { ...process.env, CAPITAL_COMMAND_PORT: String(port), node: process.execPath };
    try {
      const result = await run(["-File", join(root, "scripts", "start-server.ps1"), "-Quiet", "-Rebuild"], { cwd: root, env, timeout: 150_000 });
      expect(result.status, result.stderr + result.stdout).toBe(0);

      const names = readdirSync(root);
      for (const stem of ["server.out", "server.err", "build"]) {
        const archive = names.find((name) => new RegExp(`^${stem.replace(".", "\\.")}\\.\\d{4}-\\d{2}-\\d{2}\\.log$`).test(name));
        expect(archive, `${stem} archive in ${names.join(", ")}`).toBeDefined();
        expect(readFileSync(join(root, archive!), "utf8")).toContain(`previous ${stem}.log`);
      }

      const build = readFileSync(join(root, "build.log"));
      expect([...build.subarray(0, 2)]).not.toEqual([0xff, 0xfe]);
      expect([...build.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
      const buildText = build.toString("utf8");
      expect(buildText).toContain(`Compiled successfully ${EM_DASH} 42 routes`);
      expect(buildText).not.toContain(MOJIBAKE);
      expect(buildText).not.toContain("\u0000");
      expect(readFileSync(join(root, "server.out.log"), "utf8")).toContain("fixture server listening");
    } finally {
      killFixtureServer(root);
    }
  }, 240_000);
});
