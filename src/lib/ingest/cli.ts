import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Channel ingest CLI — the daily "did I post anything the distribution centre
 * hasn't seen?" check.
 *
 *   npx tsx src/lib/ingest/cli.ts scan [--dry-run] [--limit <n>] [--lookback <days>] [--all]
 *   npx tsx src/lib/ingest/cli.ts ledger
 *
 * `scan` is the entrypoint for the scheduled task (see
 * scripts/daily-channel-scan.ps1). It reads the channel, skips anything this app
 * published, and hands each new live stream to the Stream Pipeline — which fans
 * it out into the long-form edit, clips, a podcast MP3, a carousel and text
 * posts, then stops at "ready to schedule". It never publishes.
 *
 * The pipeline lives in the running app, so the app has to be up (see
 * pipelineClient.ts for why the scan drives it over HTTP instead of importing
 * the store).
 */

// Next.js loads .env automatically; this CLI runs outside Next, so read it here
// (without overriding anything already set in the environment).
function loadDotEnv() {
  try {
    const raw = readFileSync(path.join(process.cwd(), ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || line.trim().startsWith("#")) continue;
      const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
      if (!(match[1] in process.env)) process.env[match[1]] = value;
    }
  } catch {
    // No .env — rely on the ambient environment.
  }
}
loadDotEnv();

type Args = { positional: string[]; flags: Map<string, string | true> };

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, true);
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function flagNum(args: Args, name: string): number | undefined {
  const value = args.flags.get(name);
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main() {
  // Deferred so .env is loaded before any config is read.
  const { runDailyScan, ingestLedger, summarizeOutputs } = await import("@/lib/ingest/run");
  const { abandonedRecords, MAX_INGEST_ATTEMPTS } = await import("@/lib/ingest/ledger");
  const { explainDecision } = await import("@/lib/ingest/classify");
  const { appBaseUrl, appReachable } = await import("@/lib/ingest/pipelineClient");

  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0] ?? "help";

  if (command === "scan") {
    const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
    const dryRun = args.flags.has("dry-run");

    // Checked up front so an unreachable app is one clear line at the start
    // rather than a failure discovered after the channel read.
    if (!dryRun && !(await appReachable())) {
      console.error(
        `[ingest] Capital Command is not running at ${appBaseUrl()}. The pipeline lives in the app, so start it ` +
          `with \`npm run dev\` (or \`npm run start\`) before scanning — or set APP_BASE_URL.`
      );
      process.exitCode = 69; // EX_UNAVAILABLE
      return;
    }

    const report = await runDailyScan({
      dryRun,
      limit: flagNum(args, "limit"),
      lookbackDays: flagNum(args, "lookback"),
      liveOnly: !args.flags.has("all"),
      timeoutMs: flagNum(args, "timeout-minutes") ? flagNum(args, "timeout-minutes")! * 60_000 : undefined,
      log: (message) => console.log(`[ingest ${stamp()}] ${message}`)
    });

    if (!report.configured) process.exitCode = 78; // EX_CONFIG — nothing to do
    if (report.needsReconnect) process.exitCode = 1;

    const ready = report.ingested.filter((record) => record.outcome === "ready");
    const failed = report.ingested.filter((record) => record.outcome === "error");
    console.log("");
    console.log(
      `[ingest] ${report.candidates.length} upload(s) seen, ${ready.length} taken in, ${failed.length} failed.`
    );
    for (const record of ready) {
      console.log(`  ready    ${record.videoId}  ${record.title}`);
      console.log(`           ${summarizeOutputs(record)}`);
    }
    const stillRunning = report.ingested.filter((record) => record.outcome === "timeout");
    for (const record of stillRunning) {
      console.log(`  running  ${record.videoId}  run ${record.runId ?? "?"} still going  ${record.title}`);
    }
    for (const record of failed) {
      console.log(`  failed   ${record.videoId}  ${record.error ?? "unknown error"}`);
    }
    if (report.needsReview.length > 0) {
      console.log("");
      console.log("Held back for you to decide on:");
      for (const candidate of report.needsReview) {
        console.log(`  ${candidate.upload.videoId}  ${explainDecision(candidate.decision)}  ${candidate.upload.title}`);
      }
    }
    const abandoned = abandonedRecords(await ingestLedger());
    if (abandoned.length > 0) {
      console.log("");
      console.log(`Given up on after ${MAX_INGEST_ATTEMPTS} attempts — ingest these by hand if you still want them:`);
      for (const record of abandoned) {
        console.log(`  ${record.videoId}  ${record.error ?? "unknown error"}  ${record.title}`);
      }
    }
    if (failed.length > 0) process.exitCode = 1;
    return;
  }

  if (command === "ledger") {
    const ledger = await ingestLedger();
    console.log(`Last scan: ${ledger.lastScanAt ?? "never"}`);
    if (ledger.records.length === 0) {
      console.log("Nothing ingested yet.");
      return;
    }
    for (const record of ledger.records) {
      console.log(
        `  ${record.ingestedAt.slice(0, 19)}  ${record.outcome.padEnd(7)}  ${record.videoId}  ` +
          `${record.runId ? `run ${record.runId}` : "(no run)"}  ${record.title}`
      );
      if (record.outputs) console.log(`      ${summarizeOutputs(record)}`);
    }
    return;
  }

  console.log(
    [
      "Channel ingest commands:",
      "  scan [--dry-run] [--all] [--limit <n>] [--lookback <days>] [--timeout-minutes <n>]",
      "        read the channel and run each new live stream through the Stream Pipeline",
      "        --all also takes in ordinary long-form uploads, not just streams",
      "  ledger",
      "        show what has already been ingested"
    ].join("\n")
  );
}

void main().catch((error) => {
  console.error(`[ingest] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
