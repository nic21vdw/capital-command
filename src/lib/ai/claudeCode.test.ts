import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeCodeArgs, claudeCodeEnabled, DEFAULT_CLAUDE_CODE_MODEL, parseClaudeCodeOutput } from "@/lib/ai/claudeCode";

afterEach(() => vi.unstubAllEnvs());

describe("the Claude Code writer", () => {
  it("runs headless on Opus 5.5 with no tools, settings or MCP servers", () => {
    const args = claudeCodeArgs({ system: "Write slides." });
    expect(DEFAULT_CLAUDE_CODE_MODEL).toBe("claude-opus-5-5");
    expect(args.slice(0, 3)).toEqual(["-p", "--model", "claude-opus-5-5"]);
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("Write slides.");
  });

  it("can read only the folder of pictures it is reviewing", () => {
    const args = claudeCodeArgs({ system: "Review.", readDir: "C:/tmp/review" });
    expect(args[args.indexOf("--tools") + 1]).toBe("Read");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("Read");
    expect(args[args.indexOf("--add-dir") + 1]).toBe("C:/tmp/review");
  });

  it("takes the model from CLAUDE_CODE_MODEL", () => {
    vi.stubEnv("CLAUDE_CODE_MODEL", "claude-sonnet-5");
    expect(claudeCodeArgs({ system: "x" })[2]).toBe("claude-sonnet-5");
  });

  it("reads the answer out of the JSON result and refuses an error", () => {
    expect(parseClaudeCodeOutput('{"type":"result","is_error":false,"result":"{\\"slides\\":[]}"}')).toBe('{"slides":[]}');
    expect(parseClaudeCodeOutput('{"is_error":true,"result":"Credit balance is too low"}')).toBeNull();
    expect(parseClaudeCodeOutput("not json")).toBeNull();
  });

  it("never spawns under test, and can be switched off", () => {
    expect(claudeCodeEnabled()).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(claudeCodeEnabled()).toBe(true);
    vi.stubEnv("CAROUSEL_WRITER", "off");
    expect(claudeCodeEnabled()).toBe(false);
  });
});
