import { execFileSync, spawn, spawnSync } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scripts = join(process.cwd(), "scripts");

describe("production build isolation", () => {
  it.each([[], ["--turbopack"]])("does not inherit runtime compiler settings with arguments %j", (...args: string[]) => {
    const root = mkdtempSync(join(tmpdir(), "cc-build-"));
    try {
      mkdirSync(join(root, "node_modules/next/dist/bin"), { recursive: true });
      copyFileSync(join(scripts, "build-app.mjs"), join(root, "build-app.mjs"));
      writeFileSync(join(root, "node_modules/next/dist/bin/next"), `
        console.log(JSON.stringify({ args: process.argv.slice(2), nodeEnv: process.env.NODE_ENV,
          turbo: process.env.TURBOPACK, phase: process.env.NEXT_PHASE, runtime: process.env.NEXT_RUNTIME,
          custom: process.env.CAPITAL_COMMAND_BUILD_FIXTURE }));
        process.exit(7);
      `);
      const result = spawnSync(process.execPath, [join(root, "build-app.mjs"), ...args], {
        cwd: root, encoding: "utf8", windowsHide: true,
        env: { ...process.env, NODE_ENV: "development", TURBOPACK: "1", NEXT_PHASE: "phase-production-server",
          NEXT_RUNTIME: "edge", CAPITAL_COMMAND_BUILD_FIXTURE: "preserved" }
      });
      expect(result.status).toBe(7);
      expect(JSON.parse(result.stdout)).toEqual({ args: ["build", ...args], nodeEnv: "production", custom: "preserved" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "win32")("retries only cache failures", () => {
    const root = mkdtempSync(join(tmpdir(), "cc-build-retry-"));
    try {
      const source = readFileSync(join(scripts, "start-server.ps1"), "utf8");
      const condition = source.match(/if \(\$buildExit -ne 0 -and \(Select-String[^\n]+/);
      expect(condition).not.toBeNull();
      writeFileSync(join(root, "check.ps1"), `$buildExit = 1\n$buildLog = Join-Path $PSScriptRoot 'build.log'\n${condition![0]}\n'RETRY'\n} else { 'STOP' }\n`);
      const check = (failure: string) => {
        writeFileSync(join(root, "build.log"), failure);
        return execFileSync("powershell.exe", ["-NoProfile", "-File", join(root, "check.ps1")], { encoding: "utf8", windowsHide: true }).trim();
      };
      expect(check("Cannot find module './broken-chunk.js'")).toBe("RETRY");
      expect(check("Cannot find module for page: /_document")).toBe("RETRY");
      expect(check("Cannot read properties of undefined (reading 'call')")).toBe("RETRY");
      expect(check("<Html> should not be imported outside of pages/_document.")).toBe("STOP");
      expect(check("Module not found: native-package")).toBe("STOP");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it.skipIf(process.platform !== "win32")("logs build output before the child finishes, once per line, and preserves failure", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-build-log-"));
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const source = readFileSync(join(scripts, "update-app.ps1"), "utf8");
      const invoke = source.slice(source.indexOf("function Invoke-Script"), source.indexOf("function Step"));
      writeFileSync(join(root, "fake.ps1"), "Write-Output 'compile started'\nStart-Sleep -Seconds 5\nWrite-Output 'compile failed'\nexit 7\n");
      writeFileSync(join(root, "driver.ps1"), `$ErrorActionPreference = 'Stop'\nfunction Write-Log($message) { Add-Content (Join-Path $PSScriptRoot 'update.log') $message }\nfunction Elapsed { 'fixture' }\n${invoke}\nexit (Invoke-Script 'fake.ps1')\n`);
      const output = openSync(join(root, "driver.log"), "w");
      child = spawn("powershell.exe", ["-NoProfile", "-File", join(root, "driver.ps1")], {
        cwd: root, windowsHide: true, stdio: ["ignore", output, output]
      });
      closeSync(output);
      const done = new Promise<number | null>((resolve, reject) => {
        child!.once("error", reject);
        child!.once("exit", resolve);
      });
      const logPath = join(root, "update.log");
      const deadline = Date.now() + 20_000;
      let first = "";
      while (Date.now() < deadline && child.exitCode === null) {
        if (existsSync(logPath)) first = readFileSync(logPath, "utf8");
        if (first.includes("compile started")) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(first, readFileSync(join(root, "driver.log"), "utf8")).toContain("compile started");
      expect(first).not.toContain("compile failed");
      expect(child.exitCode).toBeNull();
      expect(await done).toBe(7);
      const log = readFileSync(logPath, "utf8");
      expect(log.match(/compile started/g)).toHaveLength(1);
      expect(log.match(/compile failed/g)).toHaveLength(1);
    } finally {
      if (child && child.exitCode === null) {
        spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
        await new Promise((resolve) => child!.once("exit", resolve));
      }
      try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
      catch (error) { console.warn(`Fixture cleanup could not remove ${root}: ${error}`); }
    }
  }, 30_000);
});
