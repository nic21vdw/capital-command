import { listRuns } from "@/lib/pipeline/runs";
import type { PipelineRun } from "@/lib/pipeline/types";
import { readLedger, scanHealth } from "@/lib/ingest/ledger";
import { activeIngestJob } from "@/lib/ingest/service";
import type { IngestLedger } from "@/lib/ingest/types";
import { bufferConfigured, hostingConfigured, publisherConfig, type PublisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";
import type { BufferState, QueueItem } from "@/lib/publisher/types";
import { threadsBlockedReason, threadsConfig, type ThreadsConfig } from "@/lib/threads/config";
import { readQueue } from "@/lib/threads/queue";
import { readThreadsState, tickHealth, type ThreadsState } from "@/lib/threads/state";
import type { ThreadsQueueItem } from "@/lib/threads/types";
import { countThreadsReplies, summarizeThreadsReplies } from "@/lib/threads/reply-summary";
import { localCalendarParts } from "@/lib/publisher/time";
import { feedBlockers } from "@/lib/podcast/feed";
import { podcastConfigured } from "@/lib/podcast/publish";
import { podcastAutomationStatus } from "@/lib/podcast/schedule";
import { readPodcastState } from "@/lib/podcast/store";
import { spotifyConnected } from "@/lib/spotify/auth";
import { readAppData } from "@/lib/storage/store";
import { readAutomationControls, readAutomationOutcome } from "@/lib/automations/store";
import { readAutomationTasks } from "@/lib/automations/tasks";
import { buildCadence } from "@/lib/automations/cadence";
import { describeInterval, describeTaskResult, truncateAtWord } from "@/lib/automations/format";
import { HELD_LIMIT, heldPosts } from "@/lib/automations/held";
import { readAutomationHistory } from "@/lib/automations/history";
import { uploadingCenterHref } from "@/lib/automations/links";
import { scheduleWindow } from "@/lib/x-posts/generator";
import { AUTOMATION_IDS, type AutomationCard, type AutomationControl, type AutomationId, type AutomationOutcome, type AutomationOverview, type AutomationTask } from "@/lib/automations/types";

type PodcastSnapshot = {
  automation: { enabled: boolean; time: string; timeZone: string };
  deliveries: { title: string; status: string; publishAt: string; nextAttemptAt?: string; lastAttemptAt?: string; lastError?: string }[];
  nextDueAt: string | null;
};

export type AutomationInputs = {
  controls: Partial<Record<AutomationId, AutomationControl>>;
  outcomes: Partial<Record<AutomationId, AutomationOutcome | null>>;
  tasks: Partial<Record<AutomationId, AutomationTask>>;
  runs: PipelineRun[];
  ledger: IngestLedger;
  ingestRunning: boolean;
  queue: QueueItem[];
  publisher: PublisherConfig;
  threads: ThreadsConfig;
  threadsItems: ThreadsQueueItem[];
  threadsState: ThreadsState;
  podcast: PodcastSnapshot;
  podcastBlockers: string[];
  spotifyConnected: boolean;
  spotifyShowLinked: boolean;
  episodes: number;
  autoScheduleOvernight: boolean;
  /** Delivery outcomes since local midnight; absent when history could not be read. */
  today?: { delivered: number; failed: number };
};

/** The command that installs each Windows task. Registration stays manual: the app only names it. */
export const REGISTER_COMMANDS = {
  publisher: "npm run publish:register",
  threads: "npm run threads:register",
  ingest: "npm run ingest:register"
} as const;

function nextAt(values: (string | undefined)[]): string | null {
  return values.filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value)))).sort()[0] ?? null;
}

/** The schedule line when no Windows task is known: say why, in plain words. */
function taskSchedule(task: AutomationTask | undefined): string {
  if (task?.state === "missing") return "Not scheduled - the Windows task is not installed";
  return "Can't check the Windows task from here";
}

function taskBlocker(task: AutomationTask | undefined, command?: string, noun = "Runner"): string[] {
  if (!task || task.state === "unknown") return ["This page can't read the Windows task, so it can't tell whether the runner is installed."];
  if (task.state === "other-checkout") return ["The Windows task runs a different checkout. This sandbox has no scheduler."];
  if (task.state === "missing") {
    return [command ? `${noun} not installed - run ${command} in the app folder, then press Refresh. The app never installs it itself.` : `${noun} not installed - the Windows scheduled task is missing.`];
  }
  if (task.state === "disabled") return ["The Windows scheduled task is disabled."];
  return [];
}

function safeDetail(value: string): string {
  return value.replace(/[\u2014]/g, " - ").replace(/Bearer\s+\S+/gi, "Bearer [hidden]").replace(/([?&](?:access_token|refresh_token|token|secret|key)=)[^\s&]+/gi, "$1[hidden]").slice(0, 450);
}

type PlatformRow = { item: QueueItem; platform: string; state: { status: string; nextAttemptAt?: string } };

/** The post that most needs a look: the first failed one, else the next one due. */
function publisherItemHref(all: PlatformRow[], pending: PlatformRow[]): string | undefined {
  const failed = all.find(({ state }) => state.status === "failed");
  const next = [...pending].sort((a, b) => Date.parse(a.state.nextAttemptAt ?? a.item.publishAt) - Date.parse(b.state.nextAttemptAt ?? b.item.publishAt))[0];
  const target = failed ?? next;
  return target ? uploadingCenterHref(target.item) : undefined;
}

export function buildAutomationOverview(input: AutomationInputs, now = new Date()): AutomationOverview {
  const card = (id: AutomationId, details: Omit<AutomationCard, "id" | "paused" | "changedAt" | "state"> & { running?: boolean }): AutomationCard => {
    const control = input.controls[id];
    const { running, ...rest } = details;
    const paused = control?.paused ?? false;
    return {
      id, ...rest, paused, changedAt: control?.changedAt ?? null,
      taskLastRunAt: input.tasks[id]?.lastRunAt ?? null,
      taskLastResult: input.tasks[id]?.lastResult ?? null,
      blockers: rest.blockers.map(safeDetail), issues: rest.issues.map(safeDetail),
      lastOutcome: rest.lastOutcome ? safeDetail(rest.lastOutcome) : null,
      state: paused ? "paused" : rest.blockers.length ? "blocked" : running ? "running" : rest.issues.length ? "attention" : rest.lastRunAt ? "ready" : "unknown"
    };
  };
  const tick = input.outcomes.pipeline;
  const pipelineIssues = input.runs.flatMap((run) => [
    ...(run.error ? [`${run.name}: ${run.error}`] : []),
    ...(run.carouselGaveUp ? [`${run.name}: ${run.carouselNote ?? "Carousel generation failed."}`] : []),
    ...(run.postsGaveUp ? [`${run.name}: ${run.postsNote ?? "Post generation failed."}`] : []),
    ...Object.entries(run.failures ?? {}).filter(([, attempts]) => attempts >= 3).map(([stage]) => `${run.name}: ${stage} has repeatedly failed.`),
    ...(run.queueFailures ?? []).map((failure) => `${run.name}: ${failure.title}: ${failure.error}`)
  ]).slice(0, 5);
  if (tick?.status === "failed") pipelineIssues.unshift(tick.detail);
  if (tick && now.getTime() - Date.parse(tick.at) > 300_000) pipelineIssues.unshift("The pipeline heartbeat has not reported in over five minutes.");
  const pipeline = card("pipeline", {
    title: "Stream Pipeline", description: "Advance stream outputs and fulfil standing scheduling instructions.", href: "/",
    blockers: [], schedule: "Every 90 seconds while the app is running", timezone: input.publisher.timezone,
    nextRunAt: tick && now.getTime() - Date.parse(tick.at) < 90_000 ? new Date(Date.parse(tick.at) + 90_000).toISOString() : null,
    nextItemAt: null, lastRunAt: tick?.at ?? null, lastOutcome: tick?.detail ?? null,
    counts: [{ label: "Saved streams", value: input.runs.length }, { label: "Standing schedules", value: input.runs.filter((run) => run.queueWhenReady).length }],
    issues: pipelineIssues
  });
  const scan = scanHealth(input.ledger, now);
  const scanTask = input.tasks.ingest;
  const ingest = card("ingest", {
    title: "Channel ingest", description: "Find new stream recordings and hand them to the pipeline.", href: "/agents",
    blockers: [...taskBlocker(scanTask, REGISTER_COMMANDS.ingest, "Channel scan"), ...(scan?.status === "not-connected" || scan?.status === "needs-reconnect" ? [scan.error ?? "Reconnect the YouTube channel."] : [])],
    schedule: scanTask?.schedule ? `Windows task runs ${describeInterval(scanTask.schedule)}` : taskSchedule(scanTask), timezone: input.publisher.timezone,
    registerCommand: REGISTER_COMMANDS.ingest,
    nextRunAt: scanTask?.nextRunAt ?? null, nextItemAt: null, lastRunAt: input.ledger.lastScanAt ?? null,
    lastOutcome: scan ? `${scan.status}${scan.ingested !== undefined ? `, ${scan.ingested} streams taken in` : ""}${scan.dryRun ? " (dry run)" : ""}` : null,
    counts: [{ label: "Recorded ingests", value: input.ledger.records.length }, { label: "Failed / timed out", value: input.ledger.records.filter((entry) => entry.outcome !== "ready").length }],
    issues: [scan?.error, ...(scan?.status === "stale" ? ["The recorded channel scan is stale."] : []), ...(scanTask?.lastResult && scanTask.lastResult !== 267009 && scanTask.lastResult !== 267011 ? [`The scheduled scan's last run ${describeTaskResult(scanTask.lastResult)}.`] : [])].filter((value): value is string => Boolean(value)),
    running: input.ingestRunning || scanTask?.state === "running"
  });
  const platformStates = input.queue.flatMap((item) => Object.entries(item.platforms).map(([platform, state]) => ({ item, platform, state })));
  const publisherTask = input.tasks.publisher;
  const publisherTick = input.outcomes.publisher;
  const pending = platformStates.filter(({ state }) => ["pending", "uploaded", "scheduled"].includes(state.status));
  const bufferStates = input.queue.filter((item) => item.buffer || input.publisher.buffer.enabled).map((item): { item: QueueItem; state: BufferState } => ({ item, state: item.buffer ?? { status: "pending", attempts: 0 } }));
  const bufferPending = bufferStates.filter(({ state }) => ["pending", "scheduled"].includes(state.status));
  const publisherIssues = platformStates.filter(({ state }) => Boolean(state.error)).map(({ item, platform, state }) => `${truncateAtWord(item.title || item.caption, 60)} (${platform}): ${state.error}`).slice(0, 5);
  publisherIssues.push(...bufferStates.filter(({ state }) => state.error || state.status === "manual").map(({ item, state }) => `${item.title} (Buffer): ${state.error ?? state.note ?? "Manual posting is required."}`).slice(0, 5));
  if (publisherTick?.status === "failed") publisherIssues.unshift(publisherTick.detail);
  if (publisherTick && now.getTime() - Date.parse(publisherTick.at) > 15 * 60_000) publisherIssues.unshift("No publisher tick recorded in over 15 minutes.");
  const publisher = card("publisher", {
    title: "Video and image publisher", description: "Upload booked posts and check delivery at their scheduled slots.", href: "/uploading-center",
    blockers: [...taskBlocker(publisherTask, REGISTER_COMMANDS.publisher), ...(!input.publisher.enabled ? ["Video and picture posting is switched off in Settings."] : []), ...(!input.publisher.platforms.length && !bufferConfigured(input.publisher) ? ["No publishing platforms or connected Buffer profiles are enabled."] : []), ...(input.publisher.buffer.enabled && !bufferConfigured(input.publisher) ? ["Buffer is enabled but its account and profiles are not configured."] : [])],
    schedule: publisherTask?.schedule ? `Windows task runs ${describeInterval(publisherTask.schedule)}` : taskSchedule(publisherTask), timezone: input.publisher.timezone,
    registerCommand: REGISTER_COMMANDS.publisher,
    itemHref: publisherItemHref(platformStates, pending),
    nextRunAt: publisherTask?.nextRunAt ?? null, nextItemAt: nextAt([...pending, ...bufferPending].map(({ item, state }) => state.nextAttemptAt ?? item.publishAt)),
    lastRunAt: publisherTick?.at ?? null, lastOutcome: publisherTick?.detail ?? null,
    counts: [{ label: "Waiting deliveries", value: pending.length + bufferPending.length }, { label: "Published", value: platformStates.filter(({ state }) => state.status === "published").length + bufferStates.filter(({ state }) => state.status === "published").length }, { label: "Failed", value: platformStates.filter(({ state }) => state.status === "failed").length + bufferStates.filter(({ state }) => state.status === "failed").length }],
    issues: publisherIssues, running: publisherTask?.state === "running"
  });
  const threadsTask = input.tasks.threads;
  const threadsTick = input.outcomes.threads;
  const health = tickHealth(input.threadsState, now);
  const threadsBlock = threadsBlockedReason(input.threads);
  const replySummary = summarizeThreadsReplies(input.threadsItems, localCalendarParts(now, input.threads.timezone).dateKey, input.threads, now, input.controls.threads?.paused);
  const replyCounts = countThreadsReplies(replySummary.items);
  const threads = card("threads", {
    title: "Threads autopilot", description: "Plan daily and stream posts, send each slot and add contextual CoLateral follow-up replies.", href: "/x-posts",
    blockers: [...taskBlocker(threadsTask, REGISTER_COMMANDS.threads, "Autopilot runner"), ...(threadsBlock ? [threadsBlock] : [])],
    schedule: `${input.threads.postsPerDay} posts per day per account; check due posts ${describeInterval(threadsTask?.schedule) ?? "on the Windows task (not checked from here)"}`, timezone: input.threads.timezone,
    registerCommand: REGISTER_COMMANDS.threads,
    nextRunAt: threadsTask?.nextRunAt ?? null,
    nextItemAt: nextAt([
      ...input.threadsItems.filter((item) => item.status === "pending").map((item) => item.nextAttemptAt ?? item.publishAt),
      ...replySummary.items.filter((item) => item.status === "pending" || item.status === "retrying").map((item) => item.nextAttemptAt)
    ]),
    lastRunAt: threadsTick?.at ?? input.threadsState.lastTickAt ?? null,
    lastOutcome: threadsTick?.detail ?? (input.threadsState.lastPostAt ? `Last post sent ${input.threadsState.lastPostAt}` : input.threadsState.lastTickAt ? "A tick was recorded; no published post recorded yet." : null),
    counts: [{ label: "Queued", value: input.threadsItems.filter((item) => item.status === "pending").length }, { label: "Published", value: input.threadsItems.filter((item) => item.status === "published").length }, { label: "Failed", value: input.threadsItems.filter((item) => item.status === "failed").length },
      { label: "Replies waiting", value: replyCounts.pending + replyCounts.retrying }, { label: "Replies published", value: replyCounts.delivered }, { label: "Replies dropped", value: replyCounts.dropped }],
    issues: [...(threadsTick?.status === "failed" ? [threadsTick.detail] : []), ...(!health.healthy && health.minutesSince !== null ? ["No Threads tick recorded in over 15 minutes."] : []), ...input.threadsItems.filter((item) => item.error || item.plugError).map((item) => `${item.topic}: ${item.error ?? item.plugError}`).slice(0, 5)],
    running: threadsTask?.state === "running"
  });
  const lastPodcast = [...input.podcast.deliveries].filter((entry) => entry.lastAttemptAt).sort((a, b) => b.lastAttemptAt!.localeCompare(a.lastAttemptAt!))[0];
  const podcast = card("podcast", {
    title: "Podcast / Spotify", description: "Publish scheduled audio to the public feed for Spotify to collect.", href: "/podcast",
    blockers: [...input.podcastBlockers, ...(!input.podcast.automation.enabled ? ["Automatic podcast scheduling is switched off on Podcast / Spotify."] : []), ...(!input.spotifyShowLinked ? ["The Spotify show has not been linked and its delivery cannot be verified."] : [])],
    schedule: `Daily at ${input.podcast.automation.time}`, timezone: input.podcast.automation.timeZone,
    nextRunAt: input.podcast.nextDueAt, nextItemAt: input.podcast.nextDueAt,
    lastRunAt: lastPodcast?.lastAttemptAt ?? null,
    lastOutcome: lastPodcast ? `${lastPodcast.title}: ${lastPodcast.status}` : null,
    counts: [{ label: "Scheduled", value: input.podcast.deliveries.filter((entry) => entry.status === "scheduled").length }, { label: "In feed", value: input.episodes }, { label: "Failed", value: input.podcast.deliveries.filter((entry) => entry.status === "failed").length }],
    issues: [...(!input.episodes ? ["Publish the first episode before claiming the feed in Spotify. A scheduled first delivery can create it."] : []), ...(!input.spotifyConnected ? ["No Spotify account connection is stored in this app. Feed delivery still uses the linked show."] : []), ...input.podcast.deliveries.filter((entry) => entry.lastError).map((entry) => `${entry.title}: ${entry.lastError}`).slice(0, 5)],
    running: input.podcast.deliveries.some((entry) => entry.status === "publishing")
  });
  const held = heldPosts(input.queue);
  return {
    checkedAt: now.toISOString(), cards: [pipeline, ingest, publisher, threads, podcast], autoScheduleOvernight: input.autoScheduleOvernight,
    cadence: buildCadence(input.publisher, input.threads, scheduleWindow()),
    held: held.slice(0, HELD_LIMIT), heldTotal: held.length,
    today: input.today ?? { delivered: 0, failed: 0 }
  };
}

export async function automationOverview(): Promise<AutomationOverview> {
  const config = publisherConfig();
  const now = new Date();
  const [controls, tasks, runs, ledger, queue, threadsItems, threadsState, podcast, state, data, connected, outcomes, history] = await Promise.all([
    readAutomationControls(), readAutomationTasks(), listRuns(), readLedger(), publishQueue(config).list(), readQueue(),
    readThreadsState(), podcastAutomationStatus(), readPodcastState(), readAppData(), spotifyConnected(),
    Promise.all(AUTOMATION_IDS.map(async (id) => [id, await readAutomationOutcome(id)] as const)),
    readAutomationHistory({ timeZone: config.timezone }, now).catch(() => null)
  ]);
  return buildAutomationOverview({
    controls, tasks, runs, ledger, queue, publisher: config, threads: threadsConfig(), threadsItems, threadsState, podcast,
    outcomes: Object.fromEntries(outcomes), ingestRunning: Boolean(activeIngestJob()),
    podcastBlockers: feedBlockers(state.show, state.episodes, { hosted: podcastConfigured(config), bucketConnected: hostingConfigured(config) }).filter((blocker) => blocker.code !== "episodes").map((blocker) => `${blocker.problem} ${blocker.fix}`),
    spotifyConnected: connected, spotifyShowLinked: Boolean(state.show.spotifyShowId), episodes: state.episodes.length,
    autoScheduleOvernight: data.settings.autoScheduleOvernight === true,
    today: history?.today
  }, now);
}
