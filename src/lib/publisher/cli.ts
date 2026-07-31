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
 *   npx tsx src/lib/publisher/cli.ts instagram connect --token <t> [--write]
 *   npx tsx src/lib/publisher/cli.ts instagram check
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
      if (item.buffer) {
        const extras = [
          item.buffer.updateIds?.length && `ids=${item.buffer.updateIds.join(",")}`,
          item.buffer.error && `error=${item.buffer.error}`
        ]
          .filter(Boolean)
          .join(" ");
        console.log(`  ${"buffer".padEnd(9)} ${item.buffer.status}${extras ? `  ${extras}` : ""}`);
      }
    }
    return;
  }

  if (command === "buffer") {
    const { syncDueToBuffer, listBufferProfiles, validateBufferAuth } = await import("@/lib/publisher/buffer");
    const { bufferConfigured } = await import("@/lib/publisher/config");
    const sub = args.positional[1] ?? "sync";

    if (!config.buffer.enabled) {
      console.error("[publisher] Buffer is off. Set BUFFER_ENABLED=true (and BUFFER_ACCESS_TOKEN / BUFFER_PROFILE_IDS).");
      process.exitCode = 1;
      return;
    }

    if (sub === "profiles" || sub === "check") {
      try {
        const profiles = await listBufferProfiles(config);
        if (sub === "check") await validateBufferAuth(config);
        console.log(`[publisher] Buffer token OK — ${profiles.length} connected profile(s):`);
        for (const p of profiles) {
          console.log(`  ${p.id ?? "(no id)"}  ${p.service ?? "?"}  ${p.formatted_username ?? ""}`);
        }
      } catch (error) {
        console.error(`[publisher] Buffer check failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
      return;
    }

    // Default: sync — schedule every due queue item into Buffer.
    if (!bufferConfigured(config)) {
      console.error("[publisher] Buffer is enabled but not connected — set BUFFER_ACCESS_TOKEN and BUFFER_PROFILE_IDS.");
      process.exitCode = 1;
      return;
    }
    const outcomes = await syncDueToBuffer(new Date(), { config });
    if (outcomes.length === 0) {
      console.log("[publisher] Buffer: nothing due to schedule.");
      return;
    }
    for (const o of outcomes) console.log(`  ${o.itemId}  ${o.outcome.padEnd(9)} ${o.detail}`);
    process.exitCode = outcomes.some((o) => o.outcome === "failed") ? 1 : 0;
    return;
  }

  if (command === "instagram") {
    const { connectInstagram, envUpdatesFor, applyEnvUpdates, inspectInstagram, REQUIRED_SCOPES } = await import(
      "@/lib/publisher/instagramConnect"
    );
    const sub = args.positional[1] ?? "connect";

    if (sub === "check") {
      try {
        const status = await inspectInstagram(config);
        console.log(`[publisher] Instagram OK — @${status.username ?? "?"} (${status.igUserId})`);
        if (status.followers !== null) console.log(`[publisher]   followers: ${status.followers.toLocaleString()}`);
        if (status.quotaUsage !== null) console.log(`[publisher]   published in the last 24h: ${status.quotaUsage}/50`);
        console.log(
          `[publisher]   token: ${
            status.neverExpires
              ? "never expires"
              : status.tokenExpiresAt
                ? `expires ${status.tokenExpiresAt}`
                : "expiry unknown — set IG_APP_ID and IG_APP_SECRET to see it"
          }`
        );
        if (status.missingScopes.length > 0) {
          console.error(`[publisher]   MISSING permissions: ${status.missingScopes.join(", ")}`);
          process.exitCode = 1;
        }
        // One Meta grant backs both platforms, so checking Instagram without
        // checking the Page is how a broken Facebook stays hidden.
        const { facebookProfile, facebookPublishProbe } = await import("@/lib/publisher/metaProfile");
        const page = await facebookProfile(config);
        if (!page) {
          console.log("[publisher] Facebook: no Page configured (FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN).");
        } else {
          const probe = await facebookPublishProbe(config);
          console.log(`[publisher] Facebook ${probe.ready ? "OK" : "NOT READY"} — ${page.title}`);
          console.log(`[publisher]   Reels: ${probe.detail}`);
          if (!probe.ready) process.exitCode = 1;
        }
      } catch (error) {
        console.error(`[publisher] Instagram check failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
      return;
    }

    const appId = flagStr(args, "app-id") ?? process.env.IG_APP_ID;
    const appSecret = flagStr(args, "app-secret") ?? process.env.IG_APP_SECRET;
    const userToken = flagStr(args, "token");
    if (!appId || !appSecret || !userToken) {
      console.error(
        [
          "Usage: instagram connect --app-id <id> --app-secret <secret> --token <short-lived user token> [--page <id|name>] [--ig-user-id <id>] [--write]",
          "",
          "The three values come from the Meta App Dashboard — see docs/INSTAGRAM_SETUP.md:",
          "  app id / secret   Settings → Basic",
          `  token             Tools → Graph API Explorer, granting ${REQUIRED_SCOPES.join(", ")}`,
          "",
          "--write saves IG_USER_ID / IG_ACCESS_TOKEN (and the Page equivalents) into .env."
        ].join("\n")
      );
      process.exitCode = 1;
      return;
    }

    const connection = await connectInstagram({
      appId,
      appSecret,
      userToken,
      pageId: flagStr(args, "page"),
      igUserId: flagStr(args, "ig-user-id"),
      graphApiVersion: config.instagram.graphApiVersion
    });

    console.log(`[publisher] connected @${connection.igUsername ?? connection.igUserId}`);
    console.log(`[publisher]   IG_USER_ID:  ${connection.igUserId}`);
    console.log(
      `[publisher]   Page:        ${connection.page ? `${connection.page.pageName} (${connection.page.pageId})` : "none — the account is reached through the business portfolio"}`
    );
    console.log(
      connection.tokenSource === "page"
        ? "[publisher]   token:       Page token (does not expire)"
        : `[publisher]   token:       user token — EXPIRES ${connection.userTokenExpiresAt ?? "in ~60 days"}, re-run this command before then`
    );
    console.log(`[publisher]   permissions: ${connection.grantedScopes.join(", ") || "(could not read)"}`);
    if (connection.quotaUsage !== null) {
      console.log(`[publisher]   published in the last 24h: ${connection.quotaUsage}/50`);
    }
    if (connection.missingScopes.length > 0) {
      console.error(
        `[publisher]   MISSING permissions: ${connection.missingScopes.join(", ")} — re-generate the token with those granted.`
      );
      process.exitCode = 1;
    }

    const updates = envUpdatesFor(connection, { appId, appSecret });
    if (args.flags.has("write")) {
      const { readFile, writeFile } = await import("node:fs/promises");
      const envPath = path.join(process.cwd(), ".env");
      const existing = await readFile(envPath, "utf8").catch(() => "");
      await writeFile(envPath, applyEnvUpdates(existing, updates), "utf8");
      console.log(`[publisher] wrote ${Object.keys(updates).join(", ")} to ${envPath}`);
      console.log("[publisher] confirm with `npm run publish:instagram:check`, then add instagram to PUBLISH_PLATFORMS.");
    } else {
      console.log("[publisher] add these to .env (or re-run with --write):");
      for (const [key, value] of Object.entries(updates)) console.log(`${key}=${value}`);
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
      "  buffer [sync|profiles|check]         schedule due posts into Buffer / inspect the connection",
      "  instagram connect --token <t>        turn a Meta token into IG_USER_ID + IG_ACCESS_TOKEN (--write saves them)",
      "  instagram check                      confirm the saved Instagram credentials still work",
      "  remove <itemId>                      drop an item from the queue"
    ].join("\n")
  );
}

void main().catch((error) => {
  console.error(`[publisher] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
