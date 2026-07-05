import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { instagramAdapter } from "@/lib/publisher/adapters/instagram";
import { tiktokAdapter } from "@/lib/publisher/adapters/tiktok";
import { youtubeAdapter } from "@/lib/publisher/adapters/youtube";
import { publisherConfig, type PublisherConfig } from "@/lib/publisher/config";
import { mediaHost } from "@/lib/publisher/hosting";
import { PermanentError, StillProcessingError, isTransient } from "@/lib/publisher/http";
import { PublishQueue, isTerminalStatus, publishQueue } from "@/lib/publisher/queue";
import { formatInTimezone } from "@/lib/publisher/time";
import type { PlatformAdapter, PlatformId, PlatformState, PublishInput, PublishPlan, QueueItem } from "@/lib/publisher/types";

/**
 * The scheduler/runner. run_due(now) processes every queue item that is due
 * and not yet in a terminal state:
 *
 *  - YouTube items upload immediately (whenever the runner first sees them)
 *    with status.publishAt — YouTube then publishes natively at the target
 *    time, so YouTube posts survive runner downtime.
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
  tiktok: tiktokAdapter
};

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

  let due = await queue.dueItems(now);
  if (options.itemId) {
    due = due.filter((entry) => entry.item.id === options.itemId);
    if (options.force) {
      const item = await queue.get(options.itemId);
      const platforms = item
        ? (Object.entries(item.platforms) as [PlatformId, PlatformState][])
            .filter(([, state]) => !isTerminalStatus(state.status))
            .map(([platform]) => platform)
        : [];
      due = item && platforms.length > 0 ? [{ item, platforms }] : [];
    }
  }
  if (due.length === 0) {
    log("[publisher] no due items.");
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
        if (!adapter.configured()) {
          throw new PermanentError(`${platform} credentials are not configured in .env.`);
        }
        await queue.claim(item, platform, now);
        // Resolve media lazily and once per item, not per platform.
        localPath ??= await resolveLocalMedia(item, config);
        if (item.mediaKey && publicUrl === undefined) {
          publicUrl = (await mediaHost(config)?.publicUrl(item.mediaKey)) ?? undefined;
        }
        const input: PublishInput = { item, localPath, publicUrl };
        const result = await adapter.publish(input);
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
  return report;
}
