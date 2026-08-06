import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SpawnCall = [string, string[], Record<string, unknown>];

const spawn = vi.fn((...args: SpawnCall) => ({ on: vi.fn(), unref: vi.fn(), args }));
vi.mock("node:child_process", () => ({ spawn: (...args: SpawnCall) => spawn(...args) }));

const UPDATE_LOG = "update-app.log";

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "release-run-"));
  writeFileSync(join(root, UPDATE_LOG), "leftover from the last release\r\n");
  return root;
}

// "A release is already running" is module state that survives the release
// itself, so each test needs its own copy of the module.
async function load() {
  vi.resetModules();
  return (await import("@/lib/release/run")).startRelease;
}

describe("startRelease", () => {
  let startRelease: (root?: string) => { started: boolean; reason?: string };

  beforeEach(async () => {
    spawn.mockClear();
    startRelease = await load();
  });

  // The bug this exists to catch is silent in every other way: a detached
  // PowerShell child on Windows exits 0 without running a line of the script,
  // so the app reported that it had started an update and nothing happened.
  it("does not launch the release as a detached child", () => {
    startRelease(sandbox());

    const options = spawn.mock.calls[0]?.[2];
    expect(options.detached).toBeFalsy();
  });

  it("launches through Start-Process so the release outlives the server it kills", () => {
    startRelease(sandbox());

    const [command, args] = spawn.mock.calls[0];
    expect(command).toBe("powershell.exe");
    expect(args.join(" ")).toContain("Start-Process");
  });

  // Its output would go to the release's own console, not to a pipe, so the
  // script writes the log itself and has to be told where.
  it("tells the script where to write its log, and empties it first", () => {
    const root = sandbox();
    startRelease(root);

    const args = spawn.mock.calls[0][1];
    expect(args.join(" ")).toContain(join(root, UPDATE_LOG));

    const log = readFileSync(join(root, UPDATE_LOG), "utf8");
    expect(log).not.toContain("leftover");
    expect(log).toContain("==> ");
  });

  it("refuses a second release while one is running", () => {
    const root = sandbox();
    expect(startRelease(root).started).toBe(true);
    expect(startRelease(root).started).toBe(false);
  });
});
