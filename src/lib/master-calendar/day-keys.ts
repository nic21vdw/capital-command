/** YYYY-MM-DD helpers shared by the Master Calendar and the Day Summary. */

const DAY_MS = 86_400_000;

/** Calendar-day arithmetic on YYYY-MM-DD keys via UTC ms (never an instant). */
export function parseDayKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

export function shiftDayKey(key: string, days: number): string {
  return new Date(parseDayKey(key) + days * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOfDayKey(key: string): number {
  return new Date(parseDayKey(key)).getUTCDay();
}

/** Today as this machine reads it, so "Today" means the day he is living in. */
export function localTodayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function formatDayKey(key: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(parseDayKey(key)).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
}

/** "Today", "Tomorrow", "Yesterday" or the weekday — how far off the day is. */
export function relativeDayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return "Today";
  if (key === shiftDayKey(todayKey, 1)) return "Tomorrow";
  if (key === shiftDayKey(todayKey, -1)) return "Yesterday";
  return formatDayKey(key, { weekday: "long" });
}
