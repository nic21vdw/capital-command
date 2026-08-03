import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { accountIdConfigured } from "@/lib/publisher/accounts";
import { facebookAdapter } from "@/lib/publisher/adapters/facebook";
import { instagramAdapter } from "@/lib/publisher/adapters/instagram";
import { tiktokAdapter } from "@/lib/publisher/adapters/tiktok";
import { youtubeAdapter } from "@/lib/publisher/adapters/youtube";
import { type BufferOutcome, syncDueToBuffer, validateBufferAuth } from "@/lib/publisher/buffer";
import { bufferConfigured, configuredPlatforms, publisherConfig, type PublisherConfig } from "@/lib/publisher/config";
import { hostMedia, mediaHost } from "@/lib/publisher/hosting";
import { describeMirrorPlan, planMirror } from "@/lib/publisher/mirror";
import { PermanentError, StillProcessingError, isTransient } from "@/lib/publisher/http";
import { PublishQueue, isTerminalStatus, newPlatformState, publishQueue } from "@/lib/publisher/queue";
import { formatInTimezone } from "@/lib/publisher/time";
import type { PlatformAdapter, PlatformId, PlatformState, PostResult, PublishInput, PublishPlan, QueueItem } from "@/lib/publisher/types";

/**
 * The scheduler/runner. run_due(now) processes every queue item that is due
 * and not yet in a terminal state:
 *
 *  - YouTube items upload immediately (whenever the runner first sees them)
 *    with status.publishAt — YouTube then publishes natively at the target
 *    time, so YouTube posts survive runner downtime. Once the target time
 *    passes, the runner double-checks the video actually went public and
 *    forces it public if YouTube ignored publishAt (adapter.finalize).
 *  - Instagram/TikTok items fire once publishAt <= now, because those APIs
 *    have no server-side scheduling.
 *
 * One entrypoint, three ways to invoke it (all through cli.ts):
 *  (a) directly:        npx tsx src/lib/publisher/cli.ts run-due
 *  (b) long-running:    npx tsx src/lib/publisher/cli.ts scheduler
 *  (c) cron:            the GitHub Actions workflow runs (a) every 15 min.
 *
 * Platforms are independent: a failure on one records that failure and moves
 * on. Transient errors retry with exponential backoff; permanent errors mark
 * the platform failed with the reason. Terminal states are never reprocessed,
 * so re-running is idempotent.
 */

export type RunOutcome = {
  itemId: string;
  clip: string;
  platform: PlatformId;
  outcome: "published" | "scheduled" | "uploaded" | "retrying" | "failed";
  detail: string;
};

export type RunReport = {
  dryRun: boolean;
  now: string;
  queue: string;
  authChecks: Array<{ platform: PlatformId; ok: boolean; detail: string }>;
  plans: Array<{ itemId: string; clip: string; due: boolean; plan: PublishPlan }>;
  outcomes: RunOutcome[];
  /** Present only when Buffer is enabled — one entry per item the Buffer pass acted on. */
  bufferOutcomes?: BufferOutcome[];
};

export type RunDueOptions = {
  dryRun?: boolean;
  adapters?: Partial<Record<PlatformId, PlatformAdapter>>;
  queue?: PublishQueue;
  config?: PublisherConfig;
  log?: (line: string) => void;
  /** Restrict the run to one queue item (the UI's per-post "publish now"). */
  itemId?: string;
  /**
   * With itemId: process every non-terminal platform immediately, ignoring
   * publishAt and retry backoff. Instagram/TikTok then post right away
   * instead of waiting for their scheduled time.
   */
  force?: boolean;
};

export const defaultAdapters: Record<PlatformId, PlatformAdapter> = {
  youtube: youtubeAdapter,
  instagram: instagramAdapter,
  tiktok: tiktokAdapter,
  facebook: facebookAdapter
};

/** Platforms whose APIs pull the video from a public URL rather than an upload. */
const PLATFORMS_NEEDING_PUBLIC_URL = new Set<PlatformId>(["instagram", "facebook"]);

/** Finds the clip bytes: the local file when present, else the hosted copy. */
async function resolveLocalMedia(item: QueueItem, config: PublisherConfig): Promise<string> {
  const localPath = path.isAbsolute(item.clipPath) ? item.clipPath : path.join(process.cwd(), item.clipPath);
  const exists = await stat(localPath)
    .then((info) => info.size > 0)
    .catch(() => false);
  if (exists) return localPath;
  if (item.mediaKey) {
    const host = mediaHost(config);
    if (host) {
      const dir = await mkdtemp(path.join(os.tmpdir(), "publisher-"));
      const dest = path.join(dir, path.basename(item.clipPath));
      await host.download(item.mediaKey, dest);
      return dest;
    }
  }
  throw new PermanentError(
    `Clip file ${item.clipPath} is not on this machine and no hosted copy exists — re-enqueue the clip where the file lives.`
  );
}

export async function runDue(now: Date = new Date(), options: RunDueOptions = {}): Promise<RunReport> {
  const config = options.config ?? publisherConfig();
  const queue = options.queue ?? publishQueue(config);
  const adapters = { ...defaultAdapters, ...options.adapters };
  const log = options.log ?? ((line: string) => console.log(line));
  const dryRun = options.dryRun ?? false;

  const report: RunReport = {
    dryRun,
    now: now.toISOString(),
    queue: queue.describe(),
    authChecks: [],
    plans: [],
    outcomes: []
  };

  if (!config.enabled) {
    log("[publisher] PUBLISH_ENABLED is not true — nothing to do.");
    return report;
  }

  log(`[publisher] ${dryRun ? "DRY RUN" : "run"} at ${formatInTimezone(now, config.timezone)} (${config.timezone}); queue: ${queue.describe()}`);

  if (dryRun) {
    // 1. Prove each configured platform's credentials actually work.
    for (const platform of config.platforms) {
      const adapter = adapters[platform];
      if (!adapter.configured()) {
        report.authChecks.push({ platform, ok: false, detail: "not configured (missing credentials in .env)" });
        continue;
      }
      try {
        await adapter.validateAuth();
        report.authChecks.push({ platform, ok: true, detail: "auth OK" });
      } catch (error) {
        report.authChecks.push({ platform, ok: false, detail: error instanceof Error ? error.message : String(error) });
      }
    }
    for (const check of report.authChecks) {
      log(`[publisher]   auth ${check.platform}: ${check.ok ? "✓" : "✗"} ${check.detail}`);
    }

    // Buffer is a delivery layer, not one of the four platforms, so it reports
    // separately. Prove its token works too when it is turned on.
    if (config.buffer.enabled) {
      if (!bufferConfigured(config)) {
        log("[publisher]   auth buffer: ✗ enabled but missing BUFFER_ACCESS_TOKEN / BUFFER_PROFILE_IDS");
      } else {
        try {
          await validateBufferAuth(config);
          log(`[publisher]   auth buffer: ✓ token OK, ${config.buffer.profileIds.length} profile(s) targeted`);
        } catch (error) {
          log(`[publisher]   auth buffer: ✗ ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // 2. Show the exact plan for every unfinished item — payload summary,
    //    resolved local + UTC publish time — without posting anything.
    for (const item of await queue.list()) {
      const due = new Set(queue.duePlatforms(item, now));
      for (const [platform, state] of Object.entries(item.platforms)) {
        if (isTerminalStatus(state.status)) continue;
        const adapter = adapters[platform as PlatformId];
        const plan = adapter.buildPlan({ item, localPath: item.clipPath, publicUrl: undefined });
        report.plans.push({ itemId: item.id, clip: item.clipPath, due: due.has(platform as PlatformId), plan });
      }
    }
    for (const entry of report.plans) {
      log(
        `[publisher]   plan ${entry.itemId} → ${entry.plan.platform} at ${entry.plan.publishAtLocal} local / ${entry.plan.publishAtUtc} UTC ` +
          `(${entry.due ? "due now" : "waiting"})\n` +
          `[publisher]     endpoint: ${entry.plan.endpoint}\n` +
          `[publisher]     payload: ${JSON.stringify(entry.plan.payload).slice(0, 500)}\n` +
          entry.plan.notes.map((note) => `[publisher]     note: ${note}`).join("\n")
      );
    }
    log(`[publisher] dry run complete — nothing was posted.`);
    return report;
  }

  // Buffer delivery pass (opt-in). Runs independently of the direct-platform
  // loop below and only ever writes to each item's `buffer` field, so it can
  // never disturb a platform's publish state. A thrown error here is contained
  // so it cannot abort the direct publishes.
  const runBuffer = async () => {
    if (!config.buffer.enabled) return;
    try {
      const bufferOutcomes = await syncDueToBuffer(now, { queue, config, log, itemId: options.itemId });
      if (bufferOutcomes.length > 0) report.bufferOutcomes = bufferOutcomes;
    } catch (error) {
      log(`[publisher]   buffer pass failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Keep every platform on one schedule before deciding what is due, so a clip
  // that was only ever scheduled on YouTube is already on Instagram/Facebook by
  // the time its slot comes round. Contained: a failure here must not stop the
  // posts that are already queued from going out.
  if (config.mirror.enabled && !options.itemId) {
    try {
      const configured = new Set(configuredPlatforms(config));
      const targets = config.mirror.targets.filter((platform) => configured.has(platform));
      if (targets.length > 0) {
        const plan = planMirror(await queue.list(), {
          lead: config.mirror.lead,
          targets,
          mode: config.mirror.mode,
          now
        });
        for (const skip of plan.skipped) log(`[publisher]   mirror skipped ${skip.itemId}: ${skip.reason}`);
        for (const add of plan.additions) {
          const item = await queue.get(add.itemId);
          if (!item || item.platforms[add.platform]) continue;
          item.platforms[add.platform] = newPlatformState();
          await queue.add(item);
        }
        // Shuffled slots hold a different clip per platform, which one item
        // cannot express, so each gets its own.
        for (const entry of plan.newItems) {
          const source = await queue.get(entry.sourceItemId);
          if (!source) continue;
          await queue.add({
            ...source,
            id: crypto.randomUUID().slice(0, 8),
            publishAt: entry.publishAt,
            createdAt: new Date().toISOString(),
            platforms: { [entry.platform]: newPlatformState() }
          });
        }
        if (plan.additions.length + plan.newItems.length > 0) {
          log(`[publisher] mirrored ${config.mirror.lead} → ${describeMirrorPlan(plan)}`);
        }
      }
    } catch (error) {
      log(`[publisher]   mirror pass failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let due = await queue.dueItems(now);
  if (options.itemId) {
    due = due.filter((entry) => entry.item.id === options.itemId);
    if (options.force) {
      const item = await queue.get(options.itemId);
      const platforms = item
        ? (Object.entries(item.platforms) as [PlatformId, PlatformState][])
            // "scheduled" is included so "publish now" flips the video public
            // immediately instead of waiting for the slot time.
            .filter(([, state]) => !isTerminalStatus(state.status) || state.status === "scheduled")
            .map(([platform]) => platform)
        : [];
      due = item && platforms.length > 0 ? [{ item, platforms }] : [];
    }
  }
  if (due.length === 0) {
    log("[publisher] no due items.");
    await runBuffer();
    return report;
  }

  for (const { item, platforms } of due) {
    let localPath: string | null = null;
    let publicUrl: string | undefined;
    for (const platform of platforms) {
      const adapter = adapters[platform];
      const record = (outcome: RunOutcome["outcome"], detail: string) => {
        report.outcomes.push({ itemId: item.id, clip: item.clipPath, platform, outcome, detail });
        log(`[publisher]   ${item.id} → ${platform}: ${outcome} — ${detail}`);
      };
      try {
        // Account-aware: an item on an extra account publishes with that
        // account's own credentials, not the platform's .env defaults.
        if (!(await accountIdConfigured(platform, item.accountId, config))) {
          throw new PermanentError(`${platform} credentials are not configured for this account.`);
        }
        const state = item.platforms[platform];
        let result: PostResult;
        if (state?.status === "scheduled") {
          // Already uploaded with native scheduling; verify the platform made
          // it public at the slot time and force it if not. No media needed.
          if (!adapter.finalize) continue;
          await queue.claim(item, platform, now);
          result = await adapter.finalize(item, state);
        } else {
          await queue.claim(item, platform, now);
          // Resolve media lazily and once per item, not per platform.
          localPath ??= await resolveLocalMedia(item, config);
          if (publicUrl === undefined) {
            // An item queued before hosting was configured has no mediaKey, and
            // Instagram/Facebook cannot post without one. Upload it now rather
            // than failing forever on a clip that is sitting right here.
            if (!item.mediaKey && PLATFORMS_NEEDING_PUBLIC_URL.has(platform) && mediaHost(config)) {
              item.mediaKey = (await hostMedia(localPath, item.id)).key;
              await queue.save();
            }
            if (item.mediaKey) {
              publicUrl = (await mediaHost(config)?.publicUrl(item.mediaKey)) ?? undefined;
            }
          }
          const input: PublishInput = { item, localPath, publicUrl };
          result = await adapter.publish(input);
        }
        await queue.recordSuccess(item, platform, result, now);
        record(result.status, result.detail ?? "");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof StillProcessingError) {
          // Media accepted, platform still processing: remember the handle so
          // the next run resumes polling instead of re-uploading.
          await queue.recordSuccess(item, platform, { status: "uploaded", containerId: error.containerId, detail: message }, now);
          record("uploaded", message);
          continue;
        }
        const transient = isTransient(error);
        await queue.recordFailure(item, platform, { message, transient }, now);
        const state = item.platforms[platform];
        record(
          state?.status === "failed" ? "failed" : "retrying",
          state?.status === "failed" ? message : `${message} (next attempt ${state?.nextAttemptAt ?? "soon"})`
        );
      }
    }
  }

  await runBuffer();
  return report;
}
