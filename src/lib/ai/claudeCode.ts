import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_CLAUDE_CODE_MODEL = "claude-opus-5-5";
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;

export type ClaudeCodeRequest = {
  system: string;
  prompt: string;
  readDir?: string;
  timeoutMs?: number;
};

const NESTED_SESSION_ENV = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT", "CLAUDE_CODE_SESSION_ID"];

let missingBinary = false;

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function claudeCodeModel(): string {
  return env("CLAUDE_CODE_MODEL") || DEFAULT_CLAUDE_CODE_MODEL;
}

export function claudeCodeBinary(): string {
  const configured = env("CLAUDE_CODE_BIN");
  if (configured) return configured;
  const local = path.join(os.homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  return existsSync(local) ? local : "claude";
}

export function claudeCodeEnabled(): boolean {
  if (missingBinary) return false;
  const switchValue = env("CAROUSEL_WRITER").toLowerCase();
  return switchValue !== "off" && switchValue !== "default" && env("NODE_ENV") !== "test";
}

export function claudeCodeArgs(request: Pick<ClaudeCodeRequest, "system" | "readDir">, model = claudeCodeModel()): string[] {
  const args = [
    "-p",
    "--model",
    model,
    "--output-format",
    "json",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--system-prompt",
    request.system
  ];
  if (request.readDir) args.push("--tools", "Read", "--allowedTools", "Read", "--add-dir", request.readDir);
  else args.push("--tools", "");
  const effort = env("CLAUDE_CODE_EFFORT");
  if (effort) args.push("--effort", effort);
  return args;
}

export function parseClaudeCodeOutput(stdout: string): string | null {
  const start = stdout.indexOf("{");
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(stdout.slice(start)) as { result?: unknown; is_error?: unknown };
    if (parsed.is_error === true || typeof parsed.result !== "string" || !parsed.result.trim()) return null;
    return parsed.result;
  } catch {
    return null;
  }
}

export async function runClaudeCode(request: ClaudeCodeRequest): Promise<string | null> {
  if (!claudeCodeEnabled()) return null;
  const cwd = request.readDir ?? path.join(os.tmpdir(), "colateral-marketing-writer");
  await mkdir(cwd, { recursive: true });
  const childEnv = { ...process.env };
  for (const name of NESTED_SESSION_ENV) delete childEnv[name];

  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const child = spawn(claudeCodeBinary(), claudeCodeArgs(request), {
      cwd,
      env: childEnv,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const timer = setTimeout(() => {
      console.warn(`[claude-code] no answer after ${Math.round((request.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s — stopping it.`);
      child.kill();
      finish(null);
    }, request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", () => undefined);
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") missingBinary = true;
      console.warn(`[claude-code] could not start: ${error.message}`);
      finish(null);
    });
    child.on("close", () => finish(parseClaudeCodeOutput(stdout)));
    child.stdin.on("error", () => undefined);
    child.stdin.end(request.prompt, "utf8");
  });
}
