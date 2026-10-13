/**
 * The order warnings are shown in on an Automations card. The card only shows
 * the first two, so the order decides what gets read: a generic "can't check
 * the background runner from here" used to sit first and push "TikTok
 * connection expired" behind a "+2 more".
 *
 *   0  something to fix now: an expired or missing connection, a failed post,
 *      a switch that is off, a runner to install
 *   1  anything else
 *   2  about this computer or this copy of the app - true, rarely actionable
 *
 * The lines are written in overview.ts and plain.ts, so the patterns live
 * beside the wording and warnings.test.ts reads both.
 */

const FIX_NOW = /connection expired|not connected|isn't connected|no .* account is connected|reconnect|failed|rejected|refused|switched off|turned off|not installed - run|not configured|not been linked|is missing|holding too many|already on the|upload limit|access token|too many/i;
const ENVIRONMENT = /can't check|can't read|different copy|no runner of its own/i;

export function warningRank(text: string): 0 | 1 | 2 {
  if (ENVIRONMENT.test(text)) return 2;
  if (FIX_NOW.test(text)) return 0;
  return 1;
}

/** Fixable-now first, environment notes last; each group keeps its original order. */
export function orderWarnings(warnings: string[]): string[] {
  return warnings
    .map((text, index) => ({ text, index, rank: warningRank(text) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.text);
}
