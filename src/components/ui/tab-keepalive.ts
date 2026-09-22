/**
 * Tabs that have been opened (or sit next to the active one) stay mounted so
 * switching platforms in Uploading Center / social screens does not remount
 * calendars and wipe scroll or draft state. Neighbors are warmed so the next
 * click is already mounted.
 */
export function nextVisitedTabs(visited: ReadonlySet<string>, active: string, tabIds: readonly string[]): Set<string> {
  const next = new Set(visited);
  if (active) next.add(active);
  const index = tabIds.indexOf(active);
  if (index > 0) next.add(tabIds[index - 1]!);
  if (index >= 0 && index < tabIds.length - 1) next.add(tabIds[index + 1]!);
  return next;
}
