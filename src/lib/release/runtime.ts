import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Initialize from instrumentation before requests arrive. Never reread a build
// stamp that an update could replace underneath the old server.
const state = globalThis as typeof globalThis & {
  __releaseRuntime?: { instance: string; running: string | null };
};

export function releaseRuntime() {
  if (!state.__releaseRuntime) {
    let running: string | null = null;
    try {
      running = readFileSync(join(process.cwd(), ".next", "BUILD_COMMIT"), "utf8").trim() || null;
    } catch {
      // Development and an unstamped build have no commit to report.
    }
    state.__releaseRuntime = { instance: randomUUID(), running };
  }
  return state.__releaseRuntime;
}
