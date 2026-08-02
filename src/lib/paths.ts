import path from "node:path";

/**
 * Where the app keeps everything it owns: the publish queue, the Threads
 * queue, tokens, clips, pipeline runs, app data. One folder, resolved in one
 * place, so a process can be pointed somewhere else without every module
 * agreeing to it separately.
 *
 * `CAPITAL_COMMAND_DATA_DIR` is what the test setup uses to send the whole
 * suite at a throwaway directory — that is what stops a test reading the real
 * tokens sitting next to the running app.
 */
export function dataRoot(): string {
  const override = process.env.CAPITAL_COMMAND_DATA_DIR;
  if (override) return override;

  // A test that reaches this line is about to read the live queues and tokens
  // of whatever checkout it happens to be running in. Fail loudly instead:
  // silence here is how a suite ends up asserting against a real token.
  if (process.env.VITEST) {
    throw new Error(
      "A test tried to read the live data folder. CAPITAL_COMMAND_DATA_DIR is unset - is vitest.setup.ts still listed in vitest.config.ts?"
    );
  }

  return path.join(process.cwd(), "data");
}

/** A path inside the data folder, e.g. dataPath("publish-queue.json"). */
export function dataPath(...segments: string[]): string {
  return path.join(dataRoot(), ...segments);
}
