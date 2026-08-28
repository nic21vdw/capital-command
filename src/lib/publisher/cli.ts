import { readFileSync } from "node:fs";
import path from "node:path";
import { dataPath } from "@/lib/paths";

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
  // Imports are deferred so .env is loaded before any config is read. The
  // credentials Settings saved are folded in at the same point and for the
  // same reason: the runner is a separate process from the app, so nothing has
  // put them into this one's environment yet.
  const { applyStoredCredentials } = await import("@/lib/publisher/credentials");
  await applyStoredCredentials();

  const { refreshClipDescription } = await import("@/lib/publisher/standingDescription");
  await refreshClipDescription();

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
      console.error('Usage: enqueue --clip <path> --at "YYYY-MM-DDTHH:mm" [--title t] [--caption c] [--hashtags a,b] [--platforms youtube,instagram,tiktok] [--visibility public|private|unlisted] [--today] [--duplicate]');
      console.error("  --today      book a time today — refused otherwise, so a batch can never land on one day.");
      console.error("  --duplicate  queue a clip the queue already carries — refused otherwise.");
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
        visibilityRaw === "public" || visibilityRaw === "private" || visibilityRaw === "unlisted" ? visibilityRaw : undefined,
      // A person at a terminal typing the flag is the only same-day/duplicate
      // booking the app makes.
      allowSameDay: args.flags.has("today"),
      allowDuplicate: args.flags.has("duplicate")
    });
    console.log(`[publisher] enqueued ${item.id}: "${item.title}"`);
    console.log(`[publisher]   clip:      ${item.clipPath}`);
    console.log(`[publisher]   publishes: ${formatInTimezone(new Date(item.publishAt), config.timezone)} (${config.timezone})`);
    console.log(`[publisher]   platforms: ${Object.keys(item.platforms).join(", ")} · visibility: ${item.visibility}`);
    if (item.mediaKey) console.log(`[publisher]   hosted:    ${item.mediaKey}`);
    // Booked is not delivered. Hand it to whatever takes a future post now —
    // YouTube uploads it and shows it as Scheduled — rather than leaving a
    // typed-out booking sitting here until the next five-minute tick.
    await runDue(new Date(), { itemId: item.id }).catch((error: unknown) =>
      console.warn(
        `[publisher] the upload after enqueue failed — the scheduler will retry: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    );
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

  // mirror [--mode match|shuffle] [--targets a,b] [--lead youtube] [--seed n] [--write]
  //
  // Copies the lead platform's upcoming schedule onto the others. Prints the
  // plan and changes nothing unless --write is passed.
  if (command === "mirror") {
    const { planMirror, planUnmirror, describeMirrorPlan } = await import("@/lib/publisher/mirror");
    const { newPlatformState } = await import("@/lib/publisher/queue");
    const queue = publishQueue(config);
    let items = await queue.list();

    const lead = (flagStr(args, "lead") ?? "youtube") as PlatformId;
    const targets = (flagStr(args, "targets") ?? "instagram,facebook")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t): t is PlatformId => (ALL_PLATFORMS as string[]).includes(t));
    const mode = flagStr(args, "mode") === "shuffle" ? "shuffle" : "match";
    const seedRaw = Number(flagStr(args, "seed"));
    const seed = Number.isFinite(seedRaw) && seedRaw > 0 ? seedRaw : 1;

    // --reset lifts a previous mirror back off before re-dealing, so switching
    // between match and shuffle doesn't leave both arrangements in the queue.
    if (args.flags.has("reset")) {
      const { removals, kept } = planUnmirror(items, targets, new Date());
      for (const keep of kept) console.log(`[publisher]   kept ${keep.itemId} ${keep.platform}: ${keep.reason}`);

      // A standalone item a previous shuffle created, still untouched: it holds
      // only target platforms, so dropping it hands the slot back to the lead.
      const isOrphan = (item: (typeof items)[number]) => {
        const platforms = Object.keys(item.platforms) as PlatformId[];
        if (platforms.length === 0) return true;
        if (new Date(item.publishAt).getTime() <= Date.now()) return false;
        return (
          platforms.every((p) => targets.includes(p)) &&
          platforms.every((p) => {
            const state = item.platforms[p]!;
            return state.status === "pending" && state.attempts === 0 && !state.postId && !state.containerId;
          })
        );
      };
      const orphans = items.filter(isOrphan);
      console.log(
        `[publisher] reset: lifting ${removals.length} untouched platform states, dropping ${orphans.length} standalone posts.`
      );

      if (args.flags.has("write")) {
        for (const removal of removals) {
          const item = await queue.get(removal.itemId);
          if (!item) continue;
          delete item.platforms[removal.platform];
          await queue.add(item, "cli-mirror-reset");
        }
        for (const orphan of orphans) await queue.remove(orphan.id, "cli-mirror-reset");
        items = await queue.list();
      } else {
        // Plan against what the reset WOULD leave, so a dry run previews the
        // new deal instead of reporting there is nothing left to do.
        const dropped = new Set(orphans.map((orphan) => orphan.id));
        const byItem = new Map<string, Set<PlatformId>>();
        for (const removal of removals) {
          byItem.set(removal.itemId, (byItem.get(removal.itemId) ?? new Set()).add(removal.platform));
        }
        items = items
          .filter((item) => !dropped.has(item.id))
          .map((item) => {
            const lifted = byItem.get(item.id);
            if (!lifted) return item;
            const platforms = { ...item.platforms };
            for (const platform of lifted) delete platforms[platform];
            return { ...item, platforms };
          });
      }
    }

    const plan = planMirror(items, { lead, targets, mode, now: new Date(), seed });
    console.log(`[publisher] mirror ${lead} → ${targets.join(", ")} (${mode}): ${describeMirrorPlan(plan)}`);
    for (const skip of plan.skipped) console.log(`[publisher]   skipped ${skip.itemId}: ${skip.reason}`);

    if (mode === "shuffle" && plan.newItems.length > 0) {
      const byId = new Map(items.map((i) => [i.id, i]));
      for (const entry of plan.newItems) {
        const source = byId.get(entry.sourceItemId);
        console.log(
          `[publisher]   ${entry.platform} ${formatInTimezone(new Date(entry.publishAt), config.timezone)} → ${source?.title ?? entry.sourceItemId}`
        );
      }
    }

    if (!args.flags.has("write")) {
      console.log("[publisher] dry run — re-run with --write to apply.");
      return;
    }

    const byId = new Map(items.map((i) => [i.id, i]));
    for (const add of plan.additions) {
      const item = byId.get(add.itemId);
      if (item) item.platforms[add.platform] = newPlatformState();
    }
    for (const entry of plan.newItems) {
      const source = byId.get(entry.sourceItemId);
      if (!source) continue;
      await queue.add(
        {
          ...source,
          id: `${entry.platform.slice(0, 2)}-${entry.slotItemId}-${crypto.randomUUID().slice(0, 6)}`,
          publishAt: entry.publishAt,
          createdAt: new Date().toISOString(),
          platforms: { [entry.platform]: newPlatformState() }
        },
        "cli-mirror"
      );
    }
    for (const add of plan.additions) {
      const item = byId.get(add.itemId);
      if (item) await queue.add(item, "cli-mirror");
    }
    console.log(`[publisher] wrote ${plan.additions.length + plan.newItems.length} scheduled posts.`);
    return;
  }

  // retitle [--write] [--push] — rewrite scheduled clips' titles through the
  // channel style guide, and optionally push them to videos already on YouTube.
  if (command === "retitle") {
    const { collectRetitleTargets, writeTitles } = await import("@/lib/publisher/retitle");
    const { readFile } = await import("node:fs/promises");
    const queue = publishQueue(config);
    const items = await queue.list();
    const now = Date.now();
    const upcoming = items.filter((i) => new Date(i.publishAt).getTime() > now);

    const jobs = JSON.parse(await readFile(dataPath("clips", "jobs.json"), "utf8"));
    // Clip Editor exports resolve through their project, not their file name.
    const appData = JSON.parse(
      await readFile(dataPath("capital-command.json"), "utf8").catch(() => "{}")
    );
    const { targets, unresolved } = collectRetitleTargets(upcoming, jobs, appData.clipProjects ?? []);
    console.log(`[publisher] ${targets.length} upcoming clips have a transcript; ${unresolved.length} do not.`);
    for (const miss of unresolved) console.log(`[publisher]   keeping title on ${miss.itemId}: ${miss.reason}`);

    const titles = await writeTitles(targets, jobs);
    if (titles.size === 0) {
      console.error("[publisher] no titles came back — leaving every title as it is.");
      process.exitCode = 1;
      return;
    }

    for (const target of targets) {
      const title = titles.get(target.item.id);
      if (!title || title === target.item.title) continue;
      console.log(`[publisher]   ${target.item.title}\n[publisher]     → ${title}`);
      if (args.flags.has("write")) {
        target.item.title = title;
        await queue.add(target.item, "cli-retitle");
      }
    }

    if (args.flags.has("write") && args.flags.has("push")) {
      const { updateYoutubeVideoTitle } = await import("@/lib/publisher/adapters/youtube");
      let pushed = 0;
      for (const target of targets) {
        const videoId = target.item.platforms.youtube?.postId;
        const title = titles.get(target.item.id);
        if (!videoId || !title) continue;
        try {
          await updateYoutubeVideoTitle(videoId, title, target.item.accountId);
          pushed += 1;
        } catch (error) {
          console.error(`[publisher]   YouTube ${videoId} not renamed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      console.log(`[publisher] renamed ${pushed} videos already on YouTube.`);
    }
    if (!args.flags.has("write")) console.log("[publisher] dry run — re-run with --write to apply (add --push to rename on YouTube).");
    return;
  }

  if (command === "reconcile") {
    const { reconcileYoutube } = await import("@/lib/publisher/reconcileYoutube");
    const report = await reconcileYoutube({
      apply: args.flags.has("write"),
      lookbackDays: Number(flagStr(args, "days") ?? 30)
    });
    if (!report.configured) {
      console.error("[publisher] YouTube is not connected — nothing to reconcile.");
      process.exitCode = 1;
      return;
    }
    for (const match of report.matched) {
      console.log(`[publisher] ${match.itemId} → ${match.videoId}  ${match.title}`);
    }
    for (const group of report.ambiguous) {
      console.log(
        `[publisher] ambiguous "${group.title}" — items ${group.itemIds.join(", ")} vs videos ${group.videoIds.join(", ")}`
      );
    }
    for (const orphan of report.orphans) {
      console.log(`[publisher] orphan ${orphan.videoId} (${orphan.privacyStatus}) ${orphan.publishedAt}  ${orphan.title}`);
    }
    console.log(
      `[publisher] ${report.matched.length} matched, ${report.ambiguous.length} ambiguous, ${report.orphans.length} orphaned videos.`
    );
    if (!report.applied) console.log("[publisher] dry run — re-run with --write to record the matches.");
    return;
  }

  if (command === "adopt") {
    const { adoptChannelVideos } = await import("@/lib/publisher/adoptChannelVideos");
    const report = await adoptChannelVideos({ apply: args.flags.has("write") });
    if (!report.configured) {
      console.error("[publisher] YouTube is not connected — nothing to read.");
      process.exitCode = 1;
      return;
    }
    if (report.needsReconnect) {
      console.error("[publisher] the saved YouTube token cannot read the channel — reconnect the account.");
      process.exitCode = 1;
      return;
    }
    if (report.error) {
      console.error(`[publisher] could not read the channel: ${report.error}`);
      process.exitCode = 1;
      return;
    }
    for (const video of report.unknown) {
      console.log(
        `[publisher]   ${video.videoId}  ${video.status.padEnd(9)} ${formatInTimezone(new Date(video.publishAtUtc), config.timezone)}  ${video.title}`
      );
    }
    console.log(
      `[publisher] ${report.unknown.length} video${report.unknown.length === 1 ? "" : "s"} on the channel the queue has no record of.`
    );
    if (!report.applied) {
      console.log("[publisher] dry run — re-run with --write to record them so the schedule can see them.");
      return;
    }
    console.log(`[publisher] adopted ${report.adopted.length} into the queue. Nothing was uploaded or re-uploaded.`);
    return;
  }

  if (command === "remove") {
    const id = args.positional[1];
    if (!id) {
      console.error("Usage: remove <itemId>");
      process.exitCode = 1;
      return;
    }
    const removed = await publishQueue(config).remove(id, "cli-remove");
    console.log(removed ? `[publisher] removed ${id}.` : `[publisher] no item ${id}.`);
    return;
  }

  if (command === "frontload") {
    const { planScheduleFrontload, isYoutubeScheduled } = await import("@/lib/publisher/scheduleShuffle");
    const { generateSlots, slotGrid } = await import("@/lib/publisher/slots");
    const { updateYoutubeVideoPublishAt } = await import("@/lib/publisher/adapters/youtube");
    const queue = publishQueue(config);
    const items = await queue.list();
    const now = new Date();
    // Moving a video YouTube already holds is only honest when the new time is
    // sent to YouTube too, so --push is what lets those move and nothing else
    // touches them.
    const push = args.flags.has("push");
    const horizon = Number(flagStr(args, "days") ?? config.bookingHorizonDays);
    const openSlots = generateSlots({ timeZone: config.timezone, days: horizon, now, ...slotGrid(config) })
      .filter((slot) => slot.bookable)
      .map((slot) => slot.utc);
    const plan = planScheduleFrontload(items, now, { openSlots, onlyPending: !push });
    const lastBefore = items
      .filter((item) => new Date(item.publishAt) > now)
      .reduce((latest, item) => (item.publishAt > latest ? item.publishAt : latest), "");
    const lastAfter = plan.moves.reduce(
      (latest, move) => (move.to > latest ? move.to : latest),
      plan.unplaced.reduce((latest, item) => (item.to > latest ? item.to : latest), "")
    );
    console.log(
      `[publisher] frontload: ${plan.moves.length} post${plan.moves.length === 1 ? "" : "s"} would move, ${plan.unchanged} stay put.`
    );
    if (lastBefore && lastAfter) {
      console.log(
        `[publisher]   the queue ends ${formatInTimezone(new Date(lastBefore), config.timezone)} now, ${formatInTimezone(new Date(lastAfter), config.timezone)} after.`
      );
    }
    for (const move of plan.moves.slice(0, 40)) {
      console.log(
        `[publisher]   ${move.id}  ${formatInTimezone(new Date(move.from), config.timezone)} → ${formatInTimezone(new Date(move.to), config.timezone)}  ${move.title}`
      );
    }
    if (plan.moves.length > 40) console.log(`[publisher]   …and ${plan.moves.length - 40} more.`);
    for (const clash of plan.collisions) {
      console.log(
        `[publisher]   UNRESOLVED ${formatInTimezone(new Date(clash.publishAt), config.timezone)} ${clash.occupant} — ${clash.itemIds.join(", ")}`
      );
    }
    for (const repeat of plan.repeats) {
      console.log(
        `[publisher]   BACK-TO-BACK ${formatInTimezone(new Date(repeat.publishAt), config.timezone)} ${repeat.source} — ${repeat.itemIds.join(", ")}`
      );
    }
    for (const stuck of plan.unplaced) {
      console.log(`[publisher]   NO SLOT WITHIN ${horizon} DAYS ${stuck.id} — ${stuck.title}`);
    }
    if (!push) {
      const holding = items.filter((item) => new Date(item.publishAt) > now && isYoutubeScheduled(item)).length;
      if (holding > 0) {
        console.log(
          `[publisher] ${holding} video${holding === 1 ? " is" : "s are"} already scheduled on YouTube and stayed put — re-run with --push to move ${holding === 1 ? "it" : "them"} and tell YouTube.`
        );
      }
    }
    if (!args.flags.has("write")) {
      console.log("[publisher] dry run — re-run with --write to save it.");
      return;
    }
    const changed = await queue.applyPublishTimes(
      plan.moves.map((move) => ({ id: move.id, publishAt: move.to })),
      "cli-frontload"
    );
    console.log(`[publisher] wrote ${changed} new time${changed === 1 ? "" : "s"} to the queue.`);
    if (!push) return;
    const byId = new Map((await queue.list()).map((item) => [item.id, item]));
    let pushed = 0;
    let failed = 0;
    for (const move of plan.moves) {
      const item = byId.get(move.id);
      if (!item || !isYoutubeScheduled(item)) continue;
      try {
        await updateYoutubeVideoPublishAt(item.platforms.youtube!.postId!, new Date(move.to), item.accountId);
        pushed += 1;
        console.log(`[publisher]   youtube ${item.platforms.youtube?.postId} → ${move.to}`);
      } catch (error) {
        failed += 1;
        console.error(
          `[publisher]   youtube ${item.platforms.youtube?.postId} failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    console.log(`[publisher] pushed ${pushed} YouTube schedule${pushed === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}.`);
    return;
  }

  if (command === "shuffle") {
    const { laneDemand, planScheduleRepair, planScheduleShuffle, isYoutubeScheduled } = await import(
      "@/lib/publisher/scheduleShuffle"
    );
    const { generateSlots, slotGrid } = await import("@/lib/publisher/slots");
    const { updateYoutubeVideoPublishAt } = await import("@/lib/publisher/adapters/youtube");
    const queue = publishQueue(config);
    const items = await queue.list();
    const seedRaw = Number(flagStr(args, "seed"));
    const seed = Number.isFinite(seedRaw) && seedRaw > 0 ? seedRaw : Date.now();
    const repair = args.flags.has("repair");
    // Moving a video YouTube already holds is only honest when the new time is
    // sent to YouTube as well, so that is what --push means and nothing else
    // touches them. A repair never moves them at all.
    const push = args.flags.has("push");
    // A repair may reach past the end of what is booked. The grid is the
    // configured slots a day for as long as we ask, so "the calendar is full"
    // is never the answer — a post with nowhere to go this month goes next.
    const now = new Date();
    const horizon = Number(flagStr(args, "days") ?? 730);
    const openSlots = generateSlots({ timeZone: config.timezone, days: horizon, now, ...slotGrid(config) })
      .filter((slot) => slot.bookable)
      .map((slot) => slot.utc);
    const plan = repair
      ? planScheduleRepair(items, now, { seed, openSlots })
      : planScheduleShuffle(items, now, { seed, onlyPending: !push });
    console.log(
      `[publisher] ${repair ? "repair" : "shuffle"}: ${plan.moves.length} post${plan.moves.length === 1 ? "" : "s"} would move, ${plan.unchanged} stay put (seed ${seed}).`
    );
    for (const move of plan.moves.slice(0, 40)) {
      console.log(
        `[publisher]   ${move.id}  ${formatInTimezone(new Date(move.from), config.timezone)} → ${formatInTimezone(new Date(move.to), config.timezone)}  ${move.title}`
      );
    }
    if (plan.moves.length > 40) console.log(`[publisher]   …and ${plan.moves.length - 40} more.`);
    for (const clash of plan.collisions) {
      console.log(
        `[publisher]   UNRESOLVED ${formatInTimezone(new Date(clash.publishAt), config.timezone)} ${clash.occupant} — ${clash.itemIds.join(", ")}`
      );
    }
    for (const repeat of plan.repeats) {
      console.log(
        `[publisher]   BACK-TO-BACK ${formatInTimezone(new Date(repeat.publishAt), config.timezone)} ${repeat.source} — ${repeat.itemIds.join(", ")}`
      );
    }
    if (plan.collisions.length === 0) {
      console.log("[publisher] no slot would carry one platform twice.");
    } else {
      const demand = laneDemand(items, now);
      console.log(
        `[publisher] ${plan.collisions.length} left over across ${demand.instants} booked instants — widen the window with --days:`
      );
      for (const lane of demand.lanes) {
        console.log(
          `[publisher]   ${lane.lane} wants ${lane.wanted}${lane.over > 0 ? `  — ${lane.over} more than the booked instants, so ${lane.over} of them need a later slot` : ""}`
        );
      }
    }
    if (!args.flags.has("write")) {
      console.log(
        "[publisher] dry run — re-run with --write to save it. --repair only fixes conflicts; --push also moves the times YouTube is holding."
      );
      return;
    }
    const changed = await queue.applyPublishTimes(
      plan.moves.map((move) => ({ id: move.id, publishAt: move.to })),
      "cli-shuffle"
    );
    console.log(`[publisher] wrote ${changed} new time${changed === 1 ? "" : "s"} to the queue.`);
    if (!push) return;
    const byId = new Map((await queue.list()).map((item) => [item.id, item]));
    let pushed = 0;
    let failed = 0;
    for (const move of plan.moves) {
      const item = byId.get(move.id);
      if (!item || !isYoutubeScheduled(item)) continue;
      try {
        await updateYoutubeVideoPublishAt(item.platforms.youtube!.postId!, new Date(move.to), item.accountId);
        pushed += 1;
        console.log(`[publisher]   youtube ${item.platforms.youtube?.postId} → ${move.to}`);
      } catch (error) {
        failed += 1;
        console.error(
          `[publisher]   youtube ${item.platforms.youtube?.postId} failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    console.log(`[publisher] pushed ${pushed} YouTube schedule${pushed === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}.`);
    if (failed > 0) process.exitCode = 1;
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
      "  mirror [--mode shuffle] [--write]    copy YouTube's upcoming schedule onto Instagram/Facebook",
      "  retitle [--write] [--push]           rewrite upcoming clip titles via the channel style guide",
      "  instagram connect --token <t>        turn a Meta token into IG_USER_ID + IG_ACCESS_TOKEN (--write saves them)",
      "  instagram check                      confirm the saved Instagram credentials still work",
      "  reconcile [--write] [--days <n>]      match uploads back to the queue items that lost their id",
      "  adopt [--write]                      record channel videos the queue has never heard of",
      "  shuffle [--repair] [--write] [--push] [--days <n>]",
      "                                       mix upcoming posts; --repair only unstacks double-booked slots",
      "  remove <itemId>                      drop an item from the queue"
    ].join("\n")
  );
}

void main().catch((error) => {
  console.error(`[publisher] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
