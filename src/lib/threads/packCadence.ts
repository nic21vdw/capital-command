/**
 * What the Threads page says about the pack and the autopilot's rhythm, derived
 * from the real configuration and never from a constant.
 *
 * The pack header used to say "~every 40 min" beside a pack of six posts and a
 * header that said "24 times a day", and called today's pack "an earlier batch"
 * because it was more than an hour old. Pure and dependency-free so the client
 * component can import it.
 */

/** The window the day's slots are spread across, in minutes past midnight. */
export type PostingWindow = { start: number; end: number };

function plural(count: number, one: string): string {
  return `${count} ${count === 1 ? one : `${one}s`}`;
}

/** "9:05 AM" from minutes past midnight; 24:00 reads as midnight. */
export function windowClock(minutes: number): string {
  if (minutes >= 1440) return "midnight";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(mins).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
}

/** "about every 55 min" / "about every 2 h 30 min": a gap in minutes, said plainly. */
export function gapText(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 120) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * The configured cadence as one badge: "24 a day, about every 60 min,
 * 12:20 AM to 11:20 PM". Null when the autopilot's settings are not known (a
 * number that cannot be derived is left off, not guessed). With several accounts
 * the figure is per account, as everywhere else on the page.
 */
export function cadenceBadge(input: { postsPerDay: number | null | undefined; accounts?: number; window?: PostingWindow | null }): string | null {
  const { postsPerDay, window } = input;
  if (postsPerDay === null || postsPerDay === undefined || !Number.isFinite(postsPerDay) || postsPerDay < 1) return null;
  const parts = [`${postsPerDay} a day${(input.accounts ?? 0) > 1 ? " per account" : ""}`];
  if (window && Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start) {
    if (postsPerDay > 1) parts.push(`about every ${gapText((window.end - window.start) / (postsPerDay - 1))}`);
    parts.push(`${windowClock(window.start)} to ${windowClock(window.end)}`);
  }
  return parts.join(", ");
}

/**
 * Says plainly when the pack on screen is not the size of the configured day:
 * "Today: 6 posts in the pack; the autopilot posts up to 24 a day." Null when
 * they agree or either number is unknown.
 */
export function packSizeNote(input: { packPosts: number; postsPerDay: number | null | undefined; label: string }): string | null {
  const { packPosts, postsPerDay } = input;
  if (postsPerDay === null || postsPerDay === undefined || !Number.isFinite(postsPerDay) || postsPerDay < 1) return null;
  if (packPosts === postsPerDay) return null;
  return `${input.label}: ${plural(packPosts, "post")} in the pack; the autopilot posts up to ${postsPerDay} a day.`;
}

/**
 * Is the pack from a day that has already ended? Decided by its DATE against
 * today's key in the autopilot's zone, never by how old it is: a pack written
 * at 6 AM is still today's pack at 3 PM. A date that is not a date claims nothing.
 */
export function isEarlierPack(packDate: string, todayKey: string | null | undefined): boolean {
  const shape = /^\d{4}-\d{2}-\d{2}$/;
  if (!todayKey || !shape.test(packDate) || !shape.test(todayKey)) return false;
  return packDate < todayKey;
}

/**
 * The span of the pack's own times, earliest to latest, as "8:10 AM to 9:20 PM".
 * Sorted by the clock rather than read first-to-last: a pack written under a
 * different window can run 9:05 AM, then 11:10 PM, then 2:20 AM, and the header
 * used to print its first and last post as a range ("9:05 AM -> 2:20 AM") that
 * ran backwards. Null for an empty pack or times that are not "HH:MM".
 */
export function packTimeRange(posts: Array<{ time: string }>): string | null {
  const minutes = posts
    .map((post) => /^(\d{1,2}):(\d{2})$/.exec(post.time))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]) * 60 + Number(match[2]))
    .filter((value) => value >= 0 && value < 1440)
    .sort((a, b) => a - b);
  if (minutes.length === 0) return null;
  const first = windowClock(minutes[0]);
  const last = windowClock(minutes[minutes.length - 1]);
  return first === last ? first : `${first} to ${last}`;
}
