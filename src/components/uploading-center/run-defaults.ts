"use client";

import { TITLE_MAX_LENGTH, appendHashtag, hasHashtag } from "@/components/uploading-center/clip-card";
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
