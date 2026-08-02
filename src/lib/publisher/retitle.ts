import path from "node:path";
import { generateViralTitles } from "@/lib/clipping/titles";
import type { QueueItem } from "@/lib/publisher/types";

/**
 * Re-titling clips that are already on the schedule.
 *
 * Queue items written before the AI titler (or when it was unavailable) carry
 * heuristic titles, which are slices of the transcript — "space. Oh, I'm
 * spelling it wrong. Oh, I'm spelling it wron…". CLAUDE.md is explicit that a
 * clip title is never a raw transcript fragment, so this rebuilds them through
 * the same `generateViralTitles` path the Clip Generator uses, from the words
 * actually spoken inside the clip's own window.
 *
 * The clip-level transcript is empty on these jobs; the words live on the
 * job's `sourceCaptions`, timed against the SOURCE video. So the clip's
 * transcript is the captions overlapping its [start, end) window.
 */

export type Caption = { start: number; end: number; text: string };

export type JobClip = {
  id: string;
  start: number;
  end: number;
  file?: string;
  downloadFile?: string;
  previewFile?: string;
  title?: string;
};

export type ClipJob = {
  id: string;
  fileName?: string;
  clips?: JobClip[];
  sourceCaptions?: Caption[];
};

/**
 * The words spoken between `start` and `end`. Captions are kept when they
 * overlap the window at all rather than only when fully inside it, so a clip
 * that opens mid-sentence still carries the sentence it opened on.
 */
export function transcriptBetween(captions: Caption[], start: number, end: number): string {
  return captions
    .filter((caption) => caption.end > start && caption.start < end)
    .map((caption) => caption.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strips the render suffix so "clip-07-ready.mp4" matches the job's "clip-07.mp4". */
function clipKey(file: string): string {
  return path
    .basename(file.replace(/\\/g, "/"))
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/-(ready|preview|vertical)$/i, "");
}

/** Finds the job clip a queue item was rendered from, by file name. */
export function matchClip(job: ClipJob, clipPath: string): JobClip | null {
  const wanted = clipKey(clipPath);
  for (const clip of job.clips ?? []) {
    for (const candidate of [clip.downloadFile, clip.file, clip.previewFile]) {
      if (candidate && clipKey(candidate) === wanted) return clip;
    }
  }
  return null;
}

/**
 * A Clip Editor project. Items exported from the editor are named after the
 * export, not the clip ("export-export-456130a1.mp4"), so their file tells us
 * nothing about which moment they came from — but the export carries the
 * project's title through to the queue, and the project knows its window into
 * the source. That title is the only link back, so it is the one we use.
 */
export type ClipProject = {
  id: string;
  jobId?: string;
  title?: string;
  name?: string;
  clipStart?: number;
  clipEnd?: number;
  captions?: Array<{ text?: string; enabled?: boolean }>;
};

export type RetitleTarget = {
  item: QueueItem;
  /** The window the clip covers in its source, and where it came from. */
  window: { start: number; end: number; via: "clip" | "project" };
  transcript: string;
};

/** The editor project an exported item came from, matched on its title. */
export function matchProject(projects: ClipProject[], item: QueueItem): ClipProject | null {
  const title = item.title.trim();
  if (!title) return null;
  return (
    projects.find((project) => project.jobId === item.jobId && (project.title === title || project.name === title)) ??
    projects.find((project) => project.title === title || project.name === title) ??
    null
  );
}

/** A project's own burned-in captions, as a last resort. */
function projectCaptionText(project: ClipProject): string {
  return (project.captions ?? [])
    .filter((caption) => caption.enabled !== false)
    .map((caption) => (caption.text ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pairs each queue item with its clip and the words spoken in it. Items whose
 * job or clip cannot be found, or whose window has no captions, are returned
 * separately — there is nothing to write a title from, so their existing title
 * stands rather than being replaced by a guess.
 */
export function collectRetitleTargets(
  items: QueueItem[],
  jobs: ClipJob[],
  projects: ClipProject[] = []
): { targets: RetitleTarget[]; unresolved: Array<{ itemId: string; reason: string }> } {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const targets: RetitleTarget[] = [];
  const unresolved: Array<{ itemId: string; reason: string }> = [];

  for (const item of items) {
    const job = item.jobId ? byId.get(item.jobId) : undefined;
    if (!job) {
      unresolved.push({ itemId: item.id, reason: `no clip job ${item.jobId ?? "(none recorded)"}` });
      continue;
    }

    const clip = matchClip(job, item.clipPath);
    const project = clip ? null : matchProject(projects, item);
    const start = clip?.start ?? project?.clipStart;
    const end = clip?.end ?? project?.clipEnd;

    if (start === undefined || end === undefined) {
      unresolved.push({
        itemId: item.id,
        reason: `nothing in job ${job.id} matches ${path.basename(item.clipPath)} and no editor project is titled "${item.title}"`
      });
      continue;
    }

    // The source captions are the fuller record; a project's own captions are
    // the fallback for a clip whose window the source transcript never reached.
    const transcript =
      transcriptBetween(job.sourceCaptions ?? [], start, end) || (project ? projectCaptionText(project) : "");
    if (!transcript) {
      unresolved.push({ itemId: item.id, reason: `no captions cover ${start}s-${end}s of job ${job.id}` });
      continue;
    }

    targets.push({ item, window: { start, end, via: clip ? "clip" : "project" }, transcript });
  }

  return { targets, unresolved };
}

/**
 * Writes a title for each target. Batched per source job so the model sees one
 * stream's clips together and can vary them against each other; a batch the
 * model doesn't answer for simply keeps its existing titles.
 */
export async function writeTitles(
  targets: RetitleTarget[],
  jobs: ClipJob[]
): Promise<Map<string, string>> {
  const byJob = new Map<string, RetitleTarget[]>();
  for (const target of targets) {
    const key = target.item.jobId ?? "unknown";
    byJob.set(key, [...(byJob.get(key) ?? []), target]);
  }

  const titles = new Map<string, string>();
  for (const [jobId, batch] of byJob) {
    const streamTitle = jobs.find((job) => job.id === jobId)?.fileName;
    const written = await generateViralTitles(
      batch.map((target) => ({ id: target.item.id, transcript: target.transcript })),
      streamTitle ? { streamTitle } : undefined
    );
    if (!written) continue;
    for (const [itemId, title] of written) titles.set(itemId, title);
  }
  return titles;
}
