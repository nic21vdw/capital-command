import { createHash } from "node:crypto";
import type { PipelineRun, PipelineRunOverview, PipelineStageKey } from "./types";
import { emptyDelivery } from "./delivery";

export type DraftSourceCommand = { commandId: string; title: string; sourceUrl: string };
export type DraftSourceReceipt = { id: string; revision: 1; status: "draft"; persisted: true };
export type MarketingSourceState = {
  ownerId: string;
  commandId: string;
  requestDigest: string;
  receipt: DraftSourceReceipt;
  /** Advances only when accepting a new immutable preparation command. */
  revision?: number;
  /** Command receipts remain in this ledger, including failures and uncertainty. */
  preparations?: import("./marketing-preparation").MarketingPreparationRecord[];
  archivedAt?: string;
};

/** No fetch is performed here. Restrict eventual downloader inputs to supported VOD sites. */
export function validateDraftSource(ownerId: string, command: DraftSourceCommand): string {
  if (!ownerId.trim() || ownerId.length > 200) throw new Error("An authenticated owner is required.");
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(command.commandId)) throw new Error("A command id is required.");
  if (!command.title.trim() || command.title.length > 200) throw new Error("A source title of 1-200 characters is required.");
  if (command.sourceUrl.length > 2048) throw new Error("The source URL is too long.");
  let url: URL;
  try { url = new URL(command.sourceUrl); } catch { throw new Error("A supported HTTPS VOD URL is required."); }
  const host = url.hostname.replace(/^www\./, "");
  const videoId = /^[a-zA-Z0-9_-]{11}$/;
  const valid = host === "youtube.com"
    ? ((url.pathname === "/watch" && videoId.test(url.searchParams.get("v") ?? "") &&
        [...url.searchParams.keys()].every((key) => key === "v")) ||
      (/^\/(live|shorts)\/[a-zA-Z0-9_-]{11}$/.test(url.pathname) && !url.search))
    : host === "youtu.be" ? videoId.test(url.pathname.slice(1)) && !url.search
    : host === "twitch.tv" ? /^\/videos\/\d+$/.test(url.pathname) && !url.search
    : host === "vimeo.com" ? /^\/\d+$/.test(url.pathname) && !url.search : false;
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !valid) {
    throw new Error("Use a public YouTube, Twitch VOD or Vimeo URL without credentials or tracking parameters.");
  }
  return createHash("sha256").update(JSON.stringify({
    operation: "create_source", ownerId, title: command.title, sourceUrl: command.sourceUrl
  })).digest("hex");
}

/** Command tombstones share the original run ledger and must outlive normal history retention. */
export function retainedRuns(runs: Iterable<PipelineRun>, limit: number): PipelineRun[] {
  const sorted = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return [...sorted.filter((run) => run.marketingSource), ...sorted.filter((run) => !run.marketingSource).slice(0, limit)];
}

/** Drafts are inert: even the legacy overview must not read media, run workers or enqueue. */
export function draftOverview(run: PipelineRun): PipelineRunOverview {
  const preparation = run.marketingSource?.preparations?.at(-1);
  const detail = !preparation ? "Source saved. Preparation has not started."
    : preparation.status === "prepared" ? "Local review proxy prepared. Full pipeline outputs have not been generated."
    : preparation.status === "failed" ? `Preparation failed: ${preparation.error ?? "Review the source and request again."}`
    : preparation.status === "uncertain" ? "Preparation outcome is uncertain. Review before requesting again."
    : `Source preparation ${preparation.status}.`;
  const keys: PipelineStageKey[] = ["source", "longform", "segments", "clips", "audio", "podcast", "images", "visuals", "posts", "schedule"];
  const stages = Object.fromEntries(keys.map((key) => [key, {
    status: "waiting" as const,
    detail: key === "source" ? detail : "Waiting for full pipeline preparation.",
    retryable: false
  }])) as PipelineRunOverview["stages"];
  const preparing = preparation && ["requested", "claimed", "running"].includes(preparation.status);
  if (preparation) {
    stages.source.status = preparation.status === "prepared" ? "ready"
      : preparing ? "running" : "error";
  }
  return {
    run, stages, retryable: [], delivery: emptyDelivery(), settled: !preparing,
    schedulable: { clipsReady: 0, longformReady: false, segments: 0, segmentsRendered: 0, audioReady: false,
      podcastPublished: false, carouselSlides: 0, visualAdReady: false, posts: 0, queued: 0 }
  };
}
