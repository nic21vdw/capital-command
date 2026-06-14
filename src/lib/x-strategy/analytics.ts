import type { XActivity } from "@/types/domain";

/**
 * Pure, isomorphic helpers for the X strategy tool. Used by both the React UI
 * (weekly tracker) and the API route (Session Brief assembly), so nothing here
 * may touch the filesystem, the network, or the Anthropic SDK.
 */

/** Local YYYY-MM-DD for a date, so "today" reflects the user's timezone. */
export function localDateKey(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/** Parse a YYYY-MM-DD key into a local-midnight Date. */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Difference in whole days between two YYYY-MM-DD keys (a - b). */
export function daysBetween(a: string, b: string): number {
  const ms = parseDateKey(a).getTime() - parseDateKey(b).getTime();
  return Math.round(ms / 86_400_000);
}

/** Monday-of-week key for the week containing `key` (weeks run Mon–Sun). */
export function weekStartKey(key: string): string {
  const date = parseDateKey(key);
  const dow = date.getDay(); // 0 Sun ... 6 Sat
  const mondayOffset = (dow + 6) % 7; // days since Monday
  date.setDate(date.getDate() - mondayOffset);
  return localDateKey(date);
}

export function addDays(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const low = item.toLowerCase();
    if (item && !seen.has(low)) {
      seen.add(low);
      out.push(item);
    }
  }
  return out;
}

export interface XAnalysis {
  /** Reply targets (handles) used in the last 7 days — avoid repeating. */
  accountsLast7Days: string[];
  /** Topics covered in the last 14 days (replies and posts) — track coverage. */
  topicsLast14Days: string[];
  repliesThisMonth: number;
  postsThisMonth: number;
  /** Accounts replied to more than twice in the last 30 days — flag these. */
  frequentAccounts: { account: string; count: number }[];
}

export function analyzeActivities(activities: XActivity[], today = localDateKey()): XAnalysis {
  const accountsLast7Days: string[] = [];
  const topicsLast14Days: string[] = [];
  let repliesThisMonth = 0;
  let postsThisMonth = 0;
  const monthPrefix = today.slice(0, 7); // YYYY-MM
  const counts30d = new Map<string, { account: string; count: number }>();

  for (const activity of activities) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(activity.date)) continue;
    const age = daysBetween(today, activity.date);
    if (age < 0) continue; // ignore future-dated entries in rolling windows

    const account = (activity.account ?? "").trim();
    const topic = (activity.topic ?? "").trim();

    if (activity.type === "reply" && age <= 6 && account) {
      accountsLast7Days.push(account);
    }
    if (age <= 13 && topic) {
      topicsLast14Days.push(topic);
    }
    if (activity.date.slice(0, 7) === monthPrefix) {
      if (activity.type === "reply") repliesThisMonth += 1;
      else postsThisMonth += 1;
    }
    if (activity.type === "reply" && age <= 29 && account) {
      const key = account.toLowerCase();
      const entry = counts30d.get(key) ?? { account, count: 0 };
      entry.count += 1;
      entry.account = account;
      counts30d.set(key, entry);
    }
  }

  const frequentAccounts = [...counts30d.values()]
    .filter((entry) => entry.count > 2)
    .sort((a, b) => b.count - a.count);

  return {
    accountsLast7Days: dedupePreserveOrder(accountsLast7Days),
    topicsLast14Days: dedupePreserveOrder(topicsLast14Days),
    repliesThisMonth,
    postsThisMonth,
    frequentAccounts
  };
}

export interface DayProgress {
  date: string;
  weekday: string; // Mon, Tue, ...
  replies: number;
  posts: number;
  isToday: boolean;
  isFuture: boolean;
  repliesMet: boolean;
  postsMet: boolean;
}

export interface WeekStatus {
  days: DayProgress[];
  replyTargetPerDay: number;
  postTargetPerDay: number;
  weekReplies: number;
  weekPosts: number;
  weekReplyTarget: number;
  weekPostTarget: number;
  /** Replies/posts still needed today, including catch-up from missed days. */
  todayReplyGoal: number;
  todayPostGoal: number;
  todayRepliesDone: number;
  todayPostsDone: number;
  remainingReplies: number;
  remainingPosts: number;
  /** Carry-over shortfall accumulated from earlier days this week. */
  replyCarryDeficit: number;
  postCarryDeficit: number;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function computeWeekStatus(
  activities: XActivity[],
  replyTargetPerDay: number,
  postTargetPerDay: number,
  today = localDateKey()
): WeekStatus {
  const start = weekStartKey(today);

  // Count replies/posts per day for the current week.
  const byDay = new Map<string, { replies: number; posts: number }>();
  for (let i = 0; i < 7; i += 1) {
    byDay.set(addDays(start, i), { replies: 0, posts: 0 });
  }
  for (const activity of activities) {
    const bucket = byDay.get(activity.date);
    if (!bucket) continue;
    if (activity.type === "reply") bucket.replies += 1;
    else bucket.posts += 1;
  }

  const days: DayProgress[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(start, i);
    const bucket = byDay.get(date)!;
    const offsetFromToday = daysBetween(date, today);
    days.push({
      date,
      weekday: WEEKDAYS[i],
      replies: bucket.replies,
      posts: bucket.posts,
      isToday: date === today,
      isFuture: offsetFromToday > 0,
      repliesMet: bucket.replies >= replyTargetPerDay,
      postsMet: bucket.posts >= postTargetPerDay
    });
  }

  const weekReplies = days.reduce((sum, d) => sum + d.replies, 0);
  const weekPosts = days.reduce((sum, d) => sum + d.posts, 0);

  // Catch-up: how far behind the per-day pace are we, counting only days that
  // have already elapsed before today? That shortfall is added to today's goal.
  const elapsedBeforeToday = days.filter((d) => !d.isToday && !d.isFuture);
  const repliesBeforeToday = elapsedBeforeToday.reduce((sum, d) => sum + d.replies, 0);
  const postsBeforeToday = elapsedBeforeToday.reduce((sum, d) => sum + d.posts, 0);
  const expectedRepliesBeforeToday = elapsedBeforeToday.length * replyTargetPerDay;
  const expectedPostsBeforeToday = elapsedBeforeToday.length * postTargetPerDay;
  const replyCarryDeficit = Math.max(0, expectedRepliesBeforeToday - repliesBeforeToday);
  const postCarryDeficit = Math.max(0, expectedPostsBeforeToday - postsBeforeToday);

  const todayEntry = days.find((d) => d.isToday);
  const todayRepliesDone = todayEntry?.replies ?? 0;
  const todayPostsDone = todayEntry?.posts ?? 0;
  const todayReplyGoal = replyTargetPerDay + replyCarryDeficit;
  const todayPostGoal = postTargetPerDay + postCarryDeficit;

  return {
    days,
    replyTargetPerDay,
    postTargetPerDay,
    weekReplies,
    weekPosts,
    weekReplyTarget: replyTargetPerDay * 7,
    weekPostTarget: postTargetPerDay * 7,
    todayReplyGoal,
    todayPostGoal,
    todayRepliesDone,
    todayPostsDone,
    remainingReplies: Math.max(0, todayReplyGoal - todayRepliesDone),
    remainingPosts: Math.max(0, todayPostGoal - todayPostsDone),
    replyCarryDeficit,
    postCarryDeficit
  };
}
