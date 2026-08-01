/**
 * How a long review list folds.
 *
 * A six hour stream reaches the gate with twenty topic segments, ten clips and
 * six posts. Rendered in full that buries the Approve button under a page of
 * rows, so each list shows a few and offers the rest — the same rule for every
 * list, kept here (dependency-free) so it can be tested without a DOM.
 */

/** Rows a folded list shows before it starts hiding them. */
export const COLLAPSED_ROWS = 5;

/**
 * The rows a list renders: everything when expanded, otherwise the first
 * `limit` PLUS every row already edited or dropped.
 *
 * Keeping touched rows visible is the part that matters. The heading counts
 * them ("18 of 20 kept"), so a dropped row that slipped under the fold would
 * make that count read as a mistake — and the edit would be invisible right up
 * until it was approved.
 */
export function foldRows<T>(
  items: T[],
  expanded: boolean,
  touched: (item: T) => boolean,
  limit = COLLAPSED_ROWS
): T[] {
  if (expanded) return items;
  return items.filter((item, index) => index < limit || touched(item));
}
