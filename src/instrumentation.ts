export async function register() {
  // The import MUST sit inside this positive check: `NEXT_RUNTIME` is replaced
  // at build time, so the edge bundle drops the branch entirely. Guarding with
  // an early return instead leaves the import reachable, and the edge build
  // then fails to resolve `os` through the ffmpeg binary lookup.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPipelineHeartbeat } = await import("@/lib/pipeline/heartbeat");
    startPipelineHeartbeat();
  }
}
