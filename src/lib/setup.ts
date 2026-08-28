import type { AppData } from "@/types/domain";

/**
 * Whether this document belongs to an install that has already been used.
 *
 * The setup screen keys off `settings.setupCompletedAt`, which no document
 * written before it existed carries - so without this, every install that was
 * already running would be shown a first-run screen on the next release. A
 * document that has a channel, a tracked upload, a project or an account is
 * not a fresh install whatever its settings say, and gets stamped as set up
 * once, on the first read after the upgrade.
 *
 * A genuinely fresh document has none of these, which is exactly what
 * `emptyData` is, so it is left alone and the setup screen shows.
 */
export function looksUsed(data: AppData): boolean {
  return Boolean(
    data.creatorProfile.channelName.trim() ||
      data.contentItems.length ||
      (data.clipProjects ?? []).length ||
      (data.videoProjects ?? []).length ||
      data.accounts.length ||
      data.holdings.length
  );
}

/**
 * Stamp a used-but-unstamped document. Returns the document unchanged, and
 * `changed: false`, when there is nothing to do - the caller only writes when
 * something actually moved.
 */
export function ensureSetupStamp(data: AppData): { data: AppData; changed: boolean } {
  if (data.settings.setupCompletedAt || !looksUsed(data)) return { data, changed: false };
  return {
    data: { ...data, settings: { ...data.settings, setupCompletedAt: new Date().toISOString() } },
    changed: true
  };
}
