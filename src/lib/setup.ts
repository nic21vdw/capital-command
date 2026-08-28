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
 * Whether this document is actually tracking a portfolio.
 *
 * The finance screens default to hidden, because they are a portfolio tracker
 * that grew up beside the publishing pipeline and are not what this pack sells.
 * An install that has holdings, accounts, expenses, goals or a watchlist in it
 * is plainly using them, though, and hiding screens somebody is mid-way through
 * using is a worse answer than showing a buyer one extra tab. So they are
 * turned on once, for those installs only.
 */
export function tracksFinances(data: AppData): boolean {
  return Boolean(
    data.holdings.length ||
      data.accounts.length ||
      data.expenses.length ||
      data.goals.length ||
      data.watchlist.length
  );
}

/**
 * Stamp a used-but-unstamped document, and turn the finance screens on for one
 * that is already tracking a portfolio. Returns the document unchanged, and
 * `changed: false`, when there is nothing to do - the caller only writes when
 * something actually moved.
 */
export function ensureSetupStamp(data: AppData): { data: AppData; changed: boolean } {
  const settings = { ...data.settings };
  let changed = false;

  if (!settings.setupCompletedAt && looksUsed(data)) {
    settings.setupCompletedAt = new Date().toISOString();
    changed = true;
  }

  // Only ever turned ON here, and only when it has not been decided. Someone
  // who switched the screens off in Settings must not have them switched back
  // on by their own holdings on the next load.
  if (settings.personalDashboard === undefined && tracksFinances(data)) {
    settings.personalDashboard = true;
    changed = true;
  }

  return changed ? { data: { ...data, settings }, changed } : { data, changed: false };
}
