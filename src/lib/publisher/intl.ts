/**
 * Every timezone conversion in the publisher goes through Intl, and BUILDING a
 * formatter is what costs — not using one. Placing the 406-item queue onto the
 * calendar built a fresh formatter per item; reusing them is measured at ~8x.
 * Formatters are immutable and stateless, so one per option set is safe to keep
 * for the life of the process (and of the tab).
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

export function dateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, formatter);
  }
  return formatter;
}
