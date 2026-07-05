import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Publisher CLI — the three ways to drive the queue from a terminal:
 *
 *   npx tsx src/lib/publisher/cli.ts run-due [--dry-run] [--now <time>]
 *   npx tsx src/lib/publisher/cli.ts scheduler [--interval <minutes>]
 *   npx tsx src/lib/publisher/cli.ts enqueue --clip <path> --at <time> [...]
 *   npx tsx src/lib/publisher/cli.ts list
 *   npx tsx src/lib/publisher/cli.ts remove <itemId>
 *
 * `scheduler` is the long-running mode for when your machine is on; the
 * GitHub Actions workflow covers the always-on cron case with `run-due`.
 * Times without an offset are interpreted in PUBLISH_TIMEZONE.
 */

// Next.js loads .env automatically; this CLI runs outside Next, so read it
// here (without overriding anything already set in the environment).
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
    // No .env — rely on the ambient environment (e.g. GitHub Actions secrets).
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

function flagStr(args: Args, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

async function main() {
  // Imports are deferred so .env is loaded before any config is read.
  const { publisherConfig } = await import("@/lib/publisher/config");
  const { publishQueue } = await import("@/lib/publisher/queue");
  const { runDue } = await import("@/lib/publisher/runner");
  const { enqueue } = await import("@/lib/publisher/enqueue");
  const { resolvePublishAt, formatInTimezone } = await import("@/lib/publisher/time");
  const { ALL_PLATFORMS } = await import("@/lib/publisher/types");
  type PlatformId = (typeof ALL_PLATFORMS)[number];

  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0] ?? "help";
  const config = publisherConfig();

  if (command === "run-due") {
    const nowFlag = flagStr(args, "now");
    const now = nowFlag ? resolvePublishAt(nowFlag, config.timezone) : new Date();
    const report = await runDue(now, { dryRun: args.flags.has("dry-run") });
    const failed = report.outcomes.filter((o) => o.outcome === "failed").length;
    const authFailed = report.authChecks.filter((c) => !c.ok).length;
    process.exitCode = failed > 0 || authFailed > 0 ? 1 : 0;
    return;
  }

  if (command === "scheduler") {
    const minutes = Number(flagStr(args, "interval") ?? 5);
    const intervalMs = Math.max(1, minutes) * 60_000;
    console.log(`[publisher] scheduler started — checking for due items every ${Math.max(1, minutes)} min. Ctrl+C to stop.`);
    const tick = async () => {
      try {
        await runDue(new Date());
      } catch (error) {
        console.error(`[publisher] run failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    await tick();
    setInterval(() => void tick(), intervalMs);
    return;
  }

  if (command === "enqueue") {
    const clip = flagStr(args, "clip");
    const at = flagStr(args, "at");
    if (!clip || !at) {
      console.error('Usage: enqueue --clip <path> --at "YYYY-MM-DDTHH:mm" [--title t] [--caption c] [--hashtags a,b] [--platforms youtube,instagram,tiktok] [--visibility public|private|unlisted]');
      process.exitCode = 1;
      return;
    }
    const platforms = flagStr(args, "platforms")
      ?.split(",")
      .map((p) => p.trim().toLowerCase())
      .filter((p): p is PlatformId => (ALL_PLATFORMS as string[]).includes(p));
    const visibilityRaw = flagStr(args, "visibility");
    const item = await enqueue({
      clipPath: clip,
      publishAt: at,
      title: flagStr(args, "title"),
      caption: flagStr(args, "caption"),
      hashtags: flagStr(args, "hashtags")
        ?.split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      platforms,
      visibility:
        visibilityRaw === "public" || visibilityRaw === "private" || visibilityRaw === "unlisted" ? visibilityRaw : undefined
    });
    console.log(`[publisher] enqueued ${item.id}: "${item.title}"`);
    console.log(`[publisher]   clip:      ${item.clipPath}`);
    console.log(`[publisher]   publishes: ${formatInTimezone(new Date(item.publishAt), config.timezone)} (${config.timezone})`);
    console.log(`[publisher]   platforms: ${Object.keys(item.platforms).join(", ")} · visibility: ${item.visibility}`);
    if (item.mediaKey) console.log(`[publisher]   hosted:    ${item.mediaKey}`);
    return;
  }

  if (command === "list") {
    const items = await publishQueue(config).list();
    if (items.length === 0) {
      console.log("[publisher] queue is empty.");
      return;
    }
    for (const item of items) {
      console.log(`${item.id}  ${formatInTimezone(new Date(item.publishAt), config.timezone)}  ${item.title}`);
      for (const [platform, state] of Object.entries(item.platforms)) {
        const extras = [state.postId && `id=${state.postId}`, state.error && `error=${state.error}`]
          .filter(Boolean)
          .join(" ");
        console.log(`  ${platform.padEnd(9)} ${state.status}${extras ? `  ${extras}` : ""}`);
      }
    }
    return;
  }

  if (command === "remove") {
    const id = args.positional[1];
    if (!id) {
      console.error("Usage: remove <itemId>");
      process.exitCode = 1;
      return;
    }
    const removed = await publishQueue(config).remove(id);
    console.log(removed ? `[publisher] removed ${id}.` : `[publisher] no item ${id}.`);
    return;
  }

  console.log(
    [
      "Publisher commands:",
      "  run-due [--dry-run] [--now <time>]   process everything due (the cron entrypoint)",
      "  scheduler [--interval <minutes>]     keep running while your machine is on",
      '  enqueue --clip <path> --at <time>    add a finished clip to the queue',
      "  list                                 show the queue and per-platform status",
      "  remove <itemId>                      drop an item from the queue"
    ].join("\n")
  );
}

void main().catch((error) => {
  console.error(`[publisher] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
