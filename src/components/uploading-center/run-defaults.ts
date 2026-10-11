"use client";

import { TITLE_MAX_LENGTH, appendHashtag, hasHashtag } from "@/components/uploading-center/clip-card";
import { splitTrailingHashtags } from "@/lib/publisher/captionTags";
import type { ClipDraft, PlatformTarget, ReadyClip } from "@/components/uploading-center/use-uploading-center";

/**
 * What a whole run of clips is aimed at, picked once instead of re-picked on
 * every card: the platform each new draft targets and the hashtags every title
 * carries. Stored in the browser, so the choice outlives a reload and follows
 * the next run of clips rather than resetting to "YouTube, no hashtags".
 *
 * Per-clip drafts persist here too. The title is saved on the backend clip
 * (see `renameClip`), but the caption and the platform have no home there, and
 * losing an AI-written caption to a reload is the whole reason this exists.
 */

export type RunDefaults = {
  platform: PlatformTarget;
  hashtags: string[];
};

export const DEFAULT_RUN_DEFAULTS: RunDefaults = { platform: "youtube", hashtags: [] };

const DEFAULTS_KEY = "capital-command:uploading-center-defaults";
const DRAFTS_KEY = "capital-command:uploading-center-drafts";
/** Drafts older than this are dropped on write, so the store can't grow forever. */
const DRAFT_TTL_MS = 60 * 24 * 60 * 60 * 1000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Appends every hashtag the title doesn't already carry, in order. Pure. */
export function applyHashtags(title: string, hashtags: string[]): string {
  return hashtags.reduce(
    (current, hashtag) => (hasHashtag(current, hashtag) ? current : appendHashtag(current, hashtag)),
    title
  );
}

/** Removes one hashtag from a title without leaving double spaces. Pure. */
export function withoutHashtag(title: string, hashtag: string): string {
  return title
    .replace(new RegExp(`${escapeRegExp(hashtag)}\\b`, "gi"), "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const TITLE_HASHTAG = /#[\p{L}\p{N}_]+/gu;

/**
 * Every hashtag a draft will carry: the ones in its title, and the trailing
 * hashtag line of its caption (which is what the AI caption writes and what
 * travels as `hashtags` when the clip is booked). Pure.
 */
export function draftHashtags(draft: Pick<ClipDraft, "title" | "caption">): string[] {
  return [...(draft.title.match(TITLE_HASHTAG) ?? []), ...splitTrailingHashtags(draft.caption).hashtags];
}

/**
 * The hashtags a run is really going out with, read from the drafts themselves
 * rather than from the run defaults: the AI writes its own per card, so a run
 * could read "no hashtags" over ten of them. Unique, in first-seen order. Pure.
 */
export function runHashtags(drafts: Array<Pick<ClipDraft, "title" | "caption">>): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const draft of drafts) {
    for (const tag of draftHashtags(draft)) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}

/** What the summary says when no hashtag is on any clip; see `hashtagSummary`. */
export const NO_HASHTAGS_SUMMARY = "No hashtags chosen - channel defaults are added";

/**
 * "#AI #vibecoding #coding +7", or "No hashtags chosen - channel defaults are
 * added". Pure.
 *
 * "Chosen" because the cards offer ten suggestion chips that read like ten
 * hashtags; none of them is on a clip until someone picks it (or a caption
 * brings its own line), and this counts only what is on. The rest of the
 * sentence is because "no hashtags" was not the whole truth: a booking with
 * none still gets the channel's standing tags (`fallbackHashtags`), so the
 * summary read as wrong over posts that carried four.
 */
export function hashtagSummary(tags: string[], shown = 3): string {
  if (tags.length === 0) return NO_HASHTAGS_SUMMARY;
  const head = tags.slice(0, shown).join(" ");
  return tags.length > shown ? `${head} +${tags.length - shown}` : head;
}

/**
 * What the bulk panel says about captions. With a model available the
 * unwritten ones are "AI writes N captions"; without one the booking falls back
 * to the clip's own title (`fallback` in the ai-copy route), and saying "AI
 * writes" over that is a promise nothing keeps. `aiAvailable` undefined (the
 * overview has not answered yet) reads as available, the default. Pure.
 */
export function captionSummary(missing: number, aiAvailable: boolean | undefined): string {
  if (missing <= 0) return "all captioned";
  if (aiAvailable === false) return "Captions: the clip titles (no AI key set)";
  return `AI writes ${missing} caption${missing === 1 ? "" : "s"}`;
}

/**
 * The one line a clip card's closed Customise row reads, built from the same
 * wording as the bulk panel's: the caption half is `captionSummary` for a card
 * with nothing typed (so it says "Captions: the clip titles (no AI key set)"
 * where no AI can write one) and "Caption written" once there is copy, and the
 * hashtag half is `hashtagSummary` of what the draft really carries. Pure.
 */
export function cardOptionsSummary(
  draft: Pick<ClipDraft, "title" | "caption">,
  aiAvailable: boolean | undefined
): string {
  const caption = draft.caption.trim() ? "Caption written" : captionSummary(1, aiAvailable);
  return `${caption} · ${hashtagSummary(draftHashtags(draft))}`;
}

/** The draft a clip starts with under the current run defaults. Pure. */
export function draftWithDefaults(clip: ReadyClip, defaults: RunDefaults): ClipDraft {
  return {
    title: applyHashtags(clip.headline.slice(0, TITLE_MAX_LENGTH), defaults.hashtags),
    caption: "",
    platform: defaults.platform,
    slotUtc: ""
  };
}

/**
 * Re-aims an existing draft when the run defaults change: hashtags that were
 * dropped from the defaults leave the title, new ones join it, and the platform
 * follows only if the card was still on the old default — a platform picked by
 * hand on one card is never overwritten. Pure.
 */
export function redraftWithDefaults(draft: ClipDraft, previous: RunDefaults, next: RunDefaults): ClipDraft {
  const removed = previous.hashtags.filter((hashtag) => !next.hashtags.includes(hashtag));
  const title = applyHashtags(removed.reduce(withoutHashtag, draft.title), next.hashtags);
  const platform = draft.platform === previous.platform ? next.platform : draft.platform;
  return {
    ...draft,
    title,
    platform,
    slotUtc: platform === draft.platform ? draft.slotUtc : ""
  };
}

export type PersistedDraft = {
  title: string;
  caption: string;
  platform: PlatformTarget;
  /** The clip's server-side headline when this was saved (see `hydrateDraft`). */
  headline: string;
  updatedAt: number;
};

/**
 * A saved draft laid over a fresh one. A stored title is only trusted while the
 * clip still has the headline it was written against — renaming the clip
 * anywhere else (Clip Generator, Clip Editor) writes the backend clip, and the
 * backend clip wins. Pure.
 */
export function hydrateDraft(fresh: ClipDraft, stored: PersistedDraft | undefined, headline: string): ClipDraft {
  if (!stored) return fresh;
  return {
    ...fresh,
    title: stored.headline === headline ? stored.title : fresh.title,
    caption: stored.caption,
    platform: stored.platform
  };
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Preferences are best-effort; a full quota must not break scheduling.
  }
}

export function readRunDefaults(): RunDefaults | null {
  const stored = readJson<Partial<RunDefaults>>(DEFAULTS_KEY);
  if (!stored) return null;
  return {
    platform: stored.platform ?? DEFAULT_RUN_DEFAULTS.platform,
    hashtags: Array.isArray(stored.hashtags) ? stored.hashtags.filter((tag) => typeof tag === "string") : []
  };
}

export function writeRunDefaults(defaults: RunDefaults): void {
  writeJson(DEFAULTS_KEY, defaults);
}

export function readClipDrafts(): Record<string, PersistedDraft> {
  return readJson<Record<string, PersistedDraft>>(DRAFTS_KEY) ?? {};
}

/** Drops expired entries so the stored map stays small. Pure. */
export function pruneDrafts(
  drafts: Record<string, PersistedDraft>,
  now = Date.now()
): Record<string, PersistedDraft> {
  return Object.fromEntries(
    Object.entries(drafts).filter(([, draft]) => now - (draft.updatedAt ?? 0) < DRAFT_TTL_MS)
  );
}

export function writeClipDraft(clipKey: string, draft: ClipDraft, headline: string): void {
  const next = pruneDrafts(readClipDrafts());
  next[clipKey] = {
    title: draft.title,
    caption: draft.caption,
    platform: draft.platform,
    headline,
    updatedAt: Date.now()
  };
  writeJson(DRAFTS_KEY, next);
}
