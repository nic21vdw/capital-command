export function nextVisitedTabs(visited: ReadonlySet<string>, active: string, tabIds: readonly string[]): Set<string> {
  const next = new Set(visited);
  if (active) next.add(active);
  const index = tabIds.indexOf(active);
  if (index > 0) next.add(tabIds[index - 1]!);
  if (index >= 0 && index < tabIds.length - 1) next.add(tabIds[index + 1]!);
  return next;
}
