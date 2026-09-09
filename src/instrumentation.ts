export async function register() {
  // The import MUST sit inside this positive check: `NEXT_RUNTIME` is replaced
  // at build time, so the edge bundle drops the branch entirely. Guarding with
  // an early return instead leaves the import reachable, and the edge build
  // then fails to resolve `os` through the ffmpeg binary lookup.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Build workers render pages, they are not app servers. Loading the media
    // pipeline in each worker adds startup work and can start background jobs
    // against the live data while an in-place release is compiling.
    if (process.env.NEXT_PHASE === "phase-production-build") return;

    const { releaseRuntime } = await import("@/lib/release/runtime");
    releaseRuntime();

    // Before anything reads config: every credential reader in this codebase
    // reads process.env, and the credentials Settings saved live in a file.
    // Folding the file in here is what lets an account be connected from the
    // app rather than by editing .env and restarting.
    const { applyStoredCredentials } = await import("@/lib/publisher/credentials");
    await applyStoredCredentials();

    // The standing clip description lives in the document and is read by code
    // that has no document to hand. Loaded once here, and refreshed by the
    // settings write in /api/data - the two moments it can change.
    const { refreshClipDescription } = await import("@/lib/publisher/standingDescription");
    await refreshClipDescription();

    const { startPipelineHeartbeat } = await import("@/lib/pipeline/heartbeat");
    startPipelineHeartbeat();
  }
}
