import { execFileSync, spawn } from "node:child_process";
import { closeSync, copyFileSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scripts = join(process.cwd(), "scripts");
const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim();

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe.skipIf(process.platform !== "win32")("Windows server restart", () => {
  it("reuses a build after docs change and keeps serving after its launcher exits", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-restart-"));
    let pid: number | undefined;
    try {
      for (const dir of ["scripts", "src", ".next", "hooks", "node_modules/next/dist/bin"]) mkdirSync(join(root, dir), { recursive: true });
      for (const file of ["start-server.ps1", "build-lock.ps1", "wait-for-url.ps1", "stamp-build-commit.mjs"]) copyFileSync(join(scripts, file), join(root, "scripts", file));
      writeFileSync(join(root, "src", "app.js"), "// invented application fixture\n");
      writeFileSync(join(root, ".gitignore"), ".next\nnode_modules\n*.log\nserver.pid\n");
      git(root, "init", "--quiet");
      git(root, "config", "user.email", "fixture@example.invalid");
      git(root, "config", "user.name", "Fixture");
      git(root, "config", "core.hooksPath", join(root, "hooks"));
      git(root, "add", "src", "scripts", ".gitignore");
      git(root, "commit", "--quiet", "-m", "Initial fixture");
      writeFileSync(join(root, ".next", "BUILD_ID"), "fixture-build");
      writeFileSync(join(root, ".next", "BUILD_COMMIT"), git(root, "rev-parse", "HEAD"));
      writeFileSync(join(root, "CHANGELOG.md"), "A documentation-only update.\n");
      git(root, "add", "CHANGELOG.md");
      git(root, "commit", "--quiet", "-m", "Document fixture");
      // No real Next build, queues, credentials or application code is run.
      writeFileSync(join(root, "node_modules/next/dist/bin/next"), `
        const http = require('node:http');
        const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
        http.createServer((req, res) => {
          if (req.url !== '/api/update/progress') { res.writeHead(503); res.end('home is busy'); return; }
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ instance: 'fixture' }));
        }).listen(port, '127.0.0.1');
      `);
      const port = await freePort();
      // File handles and process exit, as in update-app's Invoke-Script.
      // A pipe waits for EOF from the server's inherited handles too.
      const output = openSync(join(root, "launcher.log"), "w");
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts/start-server.ps1"), "-Quiet"], {
        cwd: root, windowsHide: true, stdio: ["ignore", output, output],
        env: { ...process.env, CAPITAL_COMMAND_PORT: String(port), node: process.execPath }
      });
      closeSync(output);
      const code = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(new Error("Launcher did not exit")); }, 40_000);
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
      });
      const log = readFileSync(join(root, "launcher.log"), "utf8");
      try { pid = Number(readFileSync(join(root, "server.pid"), "utf8").trim()); } catch { /* A failed launch may have no PID. */ }
      expect(code, log).toBe(0);
      expect(log).toContain("reusing the existing build");
      expect(readFileSync(join(root, ".next/BUILD_ID"), "utf8")).toBe("fixture-build");
      expect(readFileSync(join(root, ".next/BUILD_COMMIT"), "utf8").trim()).toBe(git(root, "rev-parse", "HEAD"));
      // The invoking PowerShell has exited. Its server must still be alive.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const response = await fetch(`http://127.0.0.1:${port}/api/update/progress`, { signal: AbortSignal.timeout(3000) });
      expect(await response.json()).toEqual({ instance: "fixture" });

      // Evaluate the real build decision against runtime changes in this fixture.
      const source = readFileSync(join(scripts, "start-server.ps1"), "utf8");
      const decision = source.slice(source.indexOf("function Test-BuildCurrent"), source.indexOf("function Invoke-Build"));
      writeFileSync(join(root, "check.ps1"), `$root = '${root.replace(/'/g, "''")}'\n${decision}\nTest-BuildCurrent\n`);
      writeFileSync(join(root, "src/app.js"), "// changed application fixture\n");
      const check = () => execFileSync("powershell.exe", ["-NoProfile", "-File", join(root, "check.ps1")], { encoding: "utf8", windowsHide: true }).trim();
      expect(check()).toBe("False");
      git(root, "add", "src/app.js");
      git(root, "commit", "--quiet", "-m", "Change runtime fixture");
      expect(check()).toBe("False");
    } finally {
      if (pid) { try { process.kill(pid); } catch { /* Already exited fixture server. */ } }
      await new Promise((resolve) => setTimeout(resolve, 500));
      try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
      catch (error) { console.warn(`Fixture cleanup could not remove ${root}: ${error}`); }
    }
  }, 60_000);
});
