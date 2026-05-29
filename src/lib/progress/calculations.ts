// Pure derivation layer for the progress tracker.
//
// The persistence layer only stores raw sessions. Everything else — XP events,
// streaks, level, weekly aggregates, badges — is computed from that source of
// truth here. This means editing/deleting a session is a no-op for correctness:
// you just recompute and the totals follow.

import { addDays, format, parseISO, startOfWeek } from "date-fns";
import type {
  Badge,
  DerivedProgress,
  ProgressStats,
  Session,
  WeeklyAggregate,
  XPEvent
} from "@/types/progress";
import { toLocalDateKey, toWeekKey } from "./date-utils";

export const XP_PER_HOUR = 100;
export const DAILY_STREAK_BONUS = 25;
export const WEEKLY_MILESTONE_BONUS = 250;
export const WEEKLY_MILESTONE_DAYS = 5;
export const XP_PER_LEVEL = 500;

// XP from a session = round(durationMinutes / 60 * XP_PER_HOUR).
// Rounded to keep XP events as clean integers (matches the "transparent" goal).
export function sessionXP(durationMinutes: number): number {
  return Math.round((durationMinutes / 60) * XP_PER_HOUR);
}

// Level formula: 500 XP per level, Level 1 starts at 0 XP.
export function levelFromXP(totalXP: number) {
  const safeXP = Math.max(0, totalXP);
  const currentLevel = Math.floor(safeXP / XP_PER_LEVEL) + 1;
  const xpIntoLevel = safeXP % XP_PER_LEVEL;
  const xpToNextLevel = XP_PER_LEVEL - xpIntoLevel;
  const levelProgressPercent = (xpIntoLevel / XP_PER_LEVEL) * 100;
  return { currentLevel, xpIntoLevel, xpToNextLevel, levelProgressPercent };
}

// Walks sessions in chronological order and emits the XP events that would
// have been earned along the way. Daily streak bonus: once per calendar day.
// Weekly milestone bonus: once per ISO week, awarded when the 5th distinct
// day in that week is logged.
export function buildXPEvents(sessions: Session[]): XPEvent[] {
  const ordered = [...sessions].sort((a, b) =>
    a.startTime.localeCompare(b.startTime)
  );

  const events: XPEvent[] = [];
  const seenDays = new Set<string>();
  const weekDayCounts = new Map<string, Set<string>>(); // weekKey -> set of day keys
  const weeklyBonusAwarded = new Set<string>(); // weekKey

  for (const session of ordered) {
    const dayKey = session.date;
    const weekKey = toWeekKey(session.startTime);

    // Session XP
    const sessionAmount = sessionXP(session.durationMinutes);
    if (sessionAmount > 0) {
      events.push({
        id: `xp-session-${session.id}`,
        type: "session",
        amount: sessionAmount,
        date: dayKey,
        description: `Session: ${session.durationMinutes} min`
      });
    }

    // Daily streak bonus: only first session of a calendar day triggers it.
    if (!seenDays.has(dayKey)) {
      seenDays.add(dayKey);
      events.push({
        id: `xp-daily-${dayKey}`,
        type: "daily_streak_bonus",
        amount: DAILY_STREAK_BONUS,
        date: dayKey,
        description: "Daily streak bonus"
      });
    }

    // Weekly milestone bonus: 5 distinct days in the same ISO week.
    let weekDays = weekDayCounts.get(weekKey);
    if (!weekDays) {
      weekDays = new Set<string>();
      weekDayCounts.set(weekKey, weekDays);
    }
    weekDays.add(dayKey);
    if (
      weekDays.size >= WEEKLY_MILESTONE_DAYS &&
      !weeklyBonusAwarded.has(weekKey)
    ) {
      weeklyBonusAwarded.add(weekKey);
      events.push({
        id: `xp-weekly-${weekKey}`,
        type: "weekly_milestone_bonus",
        amount: WEEKLY_MILESTONE_BONUS,
        date: dayKey,
        description: `Weekly milestone: ${WEEKLY_MILESTONE_DAYS} days logged`
      });
    }
  }

  return events;
}

// currentStreak: how many consecutive days up to (and including) today —
// or up to yesterday if today has no session — have at least one logged
// session. longestStreak: longest such run anywhere in history.
export function computeStreaks(
  sessions: Session[],
  today: Date = new Date()
): { currentStreak: number; longestStreak: number } {
  if (sessions.length === 0) return { currentStreak: 0, longestStreak: 0 };

  const dayKeys = Array.from(new Set(sessions.map((s) => s.date))).sort();

  // Longest run anywhere
  let longest = 1;
  let run = 1;
  for (let i = 1; i < dayKeys.length; i++) {
    const prev = parseISO(dayKeys[i - 1]);
    const cur = parseISO(dayKeys[i]);
    const expected = format(addDays(prev, 1), "yyyy-MM-dd");
    if (dayKeys[i] === expected) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
    void cur; // silence unused
  }

  // Current streak: walk backward from today/yesterday until we miss a day.
  const todayKey = toLocalDateKey(today);
  const daySet = new Set(dayKeys);
  let cursor = todayKey;
  if (!daySet.has(cursor)) {
    // Allow grace: if today has no session yet, the streak from yesterday still counts.
    cursor = format(addDays(parseISO(cursor), -1), "yyyy-MM-dd");
    if (!daySet.has(cursor)) {
      return { currentStreak: 0, longestStreak: longest };
    }
  }
  let current = 0;
  while (daySet.has(cursor)) {
    current += 1;
    cursor = format(addDays(parseISO(cursor), -1), "yyyy-MM-dd");
  }

  return { currentStreak: current, longestStreak: Math.max(longest, current) };
}

// 7-day rolling window ending today (inclusive).
export function buildWeeklyChart(
  sessions: Session[],
  today: Date = new Date()
): WeeklyAggregate[] {
  // Use the calendar week containing `today`, Monday-start, so the chart
  // mirrors how the weekly bonus is measured.
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const days: WeeklyAggregate[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const key = format(d, "yyyy-MM-dd");
    const daySessions = sessions.filter((s) => s.date === key);
    const minutes = daySessions.reduce((acc, s) => acc + s.durationMinutes, 0);
    days.push({
      date: key,
      label: format(d, "EEE"),
      hours: minutes / 60,
      sessions: daySessions.length
    });
  }
  return days;
}

export function computeBadges(stats: ProgressStats, sessions: Session[]): Badge[] {
  return [
    {
      id: "first-session",
      label: "First Commit",
      description: "Log your first session",
      unlocked: sessions.length >= 1
    },
    {
      id: "ten-sessions",
      label: "Cadence",
      description: "Complete 10 sessions",
      unlocked: stats.totalSessions >= 10
    },
    {
      id: "ten-hours",
      label: "Deep Work",
      description: "Log 10 total hours",
      unlocked: stats.totalHours >= 10
    },
    {
      id: "fifty-hours",
      label: "Builder",
      description: "Log 50 total hours",
      unlocked: stats.totalHours >= 50
    },
    {
      id: "hundred-hours",
      label: "Operator",
      description: "Log 100 total hours",
      unlocked: stats.totalHours >= 100
    },
    {
      id: "streak-3",
      label: "Momentum",
      description: "Hit a 3-day streak",
      unlocked: stats.longestStreak >= 3
    },
    {
      id: "streak-7",
      label: "Week On",
      description: "Hit a 7-day streak",
      unlocked: stats.longestStreak >= 7
    },
    {
      id: "streak-30",
      label: "Discipline",
      description: "Hit a 30-day streak",
      unlocked: stats.longestStreak >= 30
    },
    {
      id: "level-5",
      label: "Founder Mode",
      description: "Reach Level 5",
      unlocked: stats.currentLevel >= 5
    },
    {
      id: "level-10",
      label: "Compounded",
      description: "Reach Level 10",
      unlocked: stats.currentLevel >= 10
    }
  ];
}

export function deriveProgress(
  sessions: Session[],
  activeSession: DerivedProgress["activeSession"],
  today: Date = new Date()
): DerivedProgress {
  const xpEvents = buildXPEvents(sessions);
  const totalXP = xpEvents.reduce((acc, e) => acc + e.amount, 0);
  const totalMinutes = sessions.reduce((acc, s) => acc + s.durationMinutes, 0);
  const totalHours = totalMinutes / 60;
  const { currentStreak, longestStreak } = computeStreaks(sessions, today);
  const level = levelFromXP(totalXP);

  const stats: ProgressStats = {
    totalHours,
    totalSessions: sessions.length,
    currentStreak,
    longestStreak,
    totalXP,
    ...level
  };

  const todayKey = toLocalDateKey(today);
  const weekKey = toWeekKey(today);
  const bonusToday = xpEvents.some(
    (e) => e.type === "daily_streak_bonus" && e.date === todayKey
  );
  const bonusThisWeek = xpEvents.some(
    (e) => e.type === "weekly_milestone_bonus" && toWeekKey(e.date) === weekKey
  );

  return {
    ...stats,
    sessions,
    xpEvents,
    activeSession,
    weekly: buildWeeklyChart(sessions, today),
    bonusToday,
    bonusThisWeek,
    badges: computeBadges(stats, sessions)
  };
}
