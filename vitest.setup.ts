import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Makes the suite hermetic: the same result in the sandbox, in the production
 * checkout, and on a machine that has never signed into anything.
 *
 * Three things leaked in before this existed:
 *
 *  1. The data folder. `publisherConfig()` reads data/publisher-tokens.json and
 *     lets a cached token beat the environment, so running the suite next to
 *     the live app made the YouTube adapter test upload with Nic's real refresh
 *     token in the assertion. Every data path now resolves through
 *     `dataRoot()`, which this points at a throwaway directory.
 *  2. The environment. Whatever the shell exported — a token, a feature flag —
 *     changed what the config module returned mid-suite.
 *  3. The clock's timezone. The execution dashboard works in local dates, so a
 *     UTC machine and a Toronto machine disagreed about which week a goal was
 *     created in.
 */

process.env.TZ = "America/Toronto";

process.env.CAPITAL_COMMAND_DATA_DIR = mkdtempSync(path.join(tmpdir(), "capital-command-test-"));

// Anything the app treats as a credential or a switch. Tests that need one set
// it themselves with vi.stubEnv, so the shell never gets a say.
const APP_PREFIXES = [
  "ANTHROPIC_",
  "APP_BASE_URL",
  "BACKUP_DRIVE_",
  "BUFFER_",
  "CLIPS_",
  "DEEPSEEK_",
  "FAL_",
  "FB_",
  "IG_",
  "META_",
  "OPENAI_",
  "PUBLISH_",
  "R2_",
  "S3_",
  "THREADS_",
  "TIKTOK_",
  "XAI_",
  "YOUTUBE_"
];

for (const name of Object.keys(process.env)) {
  if (APP_PREFIXES.some((prefix) => name.startsWith(prefix))) delete process.env[name];
}
