// Reproduce baseline defects from actual function bodies at a fixed commit.
// All dependencies are stubs. No provider, queue, token or production data is used.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';

const baseline = '59454b4464665d1dde79b4fad78eb983d86542c3';
const source = path => execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' });
const section = (text, start, end) => {
  const first = text.indexOf(start);
  const last = text.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, 'Baseline function boundaries changed');
  return stripTypeScriptTypes(text.slice(first, last).replace(/\bexport /g, ''));
};
const receipts = { baseline, synthetic: true, liveRequests: 0, cases: [] };

const headlineBody = section(source('src/lib/threads/todaySummary.ts'), 'export function todayHeadline(', '/**\n * The page header:');
const headline = new Function('plural', `${headlineBody}; return todayHeadline`)((count, one) => `${count} ${one}${count === 1 ? '' : 's'}`);
const skipped = headline({ posts: 1, sent: 0, failed: 0, skipped: 1, next: null }, {});
assert.equal(skipped, '1 post today - all sent');
receipts.cases.push({ name: 'Skipped-only headline', observed: skipped, defect: 'Claims publication with no sent posts' });

const scheduleBody = section(source('src/lib/x-posts/generator.ts'), 'function hash32(', 'const POST_FORMATS:');
const times = new Function('process', 'POSTS_PER_PACK', `${scheduleBody}; return scheduleTimes`)({ env: { THREADS_DAY_START: '07:00', THREADS_DAY_END: '23:00' } }, 24)('2026-10-14');
assert.equal(times.at(-1), '23:10');
receipts.cases.push({ name: 'Configured posting window', window: '07:00-23:00', observedLastSlot: times.at(-1), defect: 'Jitter escapes configured end' });

const publishBody = section(source('src/lib/threads/api.ts'), 'export async function postToThreads(', '/** The profile a token belongs');
let sends = 0;
class ContainerFailure extends Error {
  constructor(containerId, message) { super(message); this.containerId = containerId; }
}
const post = new Function('accountUserId', 'createTextContainer', 'publishContainer', 'sleep', 'isTransient', 'ContainerPendingError', 'ContainerRejectedError', 'ThreadsPublishPausedError', `${publishBody}; return postToThreads`)(
  async () => 'fixture', async () => { throw Error('Unexpected create'); },
  async () => { sends++; throw Error('Response lost after simulated acceptance'); },
  async () => {}, () => true, ContainerFailure, ContainerFailure, Error
);
let publishError;
try { await post({ account: {}, text: 'Synthetic fixture only', containerId: 'fixture-container' }, {}); }
catch (error) { publishError = error.message; }
assert.equal(sends, 3);
receipts.cases.push({ name: 'Lost publish response', observedPublishCalls: sends, error: publishError, defect: 'Repeats an uncertain write' });

const catchUpBody = section(source('src/lib/threads/daily.ts'), 'export async function catchUpToday(', 'export type ThreadsTickResult');
let replans = 0;
const catchUp = new Function('threadsBlockedReason', 'localCalendarParts', 'slotsStillStanding', 'endOfLocalDay', 'readThreadsState', 'planTodaysBatch', 'recordThreadsState', `${catchUpBody}; return catchUpToday`)(
  () => null, () => ({ dateKey: '2026-10-14' }), async () => new Set(),
  () => new Date('2026-10-15T00:00:00Z'), async () => ({}),
  async () => { replans++; return {}; }, async () => {}
);
const recovery = await catchUp({ config: { catchUp: true, postsPerDay: 24, catchUpMinShortfall: 2, catchUpMinGapMinutes: 20, catchUpCooldownMinutes: 60 }, now: new Date('2026-10-14T12:00:00Z'), log: () => {} });
assert.equal(recovery, null);
assert.equal(replans, 0);
receipts.cases.push({ name: 'Completely missed batch', standing: 0, hoursRemaining: 12, observedReplans: replans, defect: 'Cannot recover an existing fully missed batch' });

console.log(JSON.stringify(receipts, null, 2));
