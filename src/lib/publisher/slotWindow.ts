export const SLOT_WINDOW_DAYS = 14;
export const DEFAULT_SLOT_OFFSET_DAYS = -7;

export function daysBetweenDateKeys(fromKey: string, toKey: string): number {
  const [fromYear, fromMonth, fromDay] = fromKey.split("-").map(Number);
  const [toYear, toMonth, toDay] = toKey.split("-").map(Number);
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86_400_000);
}

export function slotOffsetForDateKey(dateKey: string, todayKey: string): number {
  const daysFromToday = daysBetweenDateKeys(todayKey, dateKey);
  return (
    DEFAULT_SLOT_OFFSET_DAYS +
    Math.floor((daysFromToday - DEFAULT_SLOT_OFFSET_DAYS) / SLOT_WINDOW_DAYS) * SLOT_WINDOW_DAYS
  );
}
