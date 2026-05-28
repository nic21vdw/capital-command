import assert from "node:assert/strict";
import {
  DAILY_STREAK_BONUS,
  WEEKLY_MILESTONE_BONUS,
  buildXPEvents,
  computeStreaks,
  deriveProgress,
  levelFromXP,
  sessionXP
} from "./calculations";
import type { Session } from "@/types/progress";

function mkSession(start: string, durationMinutes: number, idSuffix = ""): Session {
  const startDate = new Date(start);
  const end = new Date(startDate.getTime() + durationMinutes * 60_000);
  // Mirrors toLocalDateKey for the test machine's local time.
  const pad = (n: number) => n.toString().padStart(2, "0");
  const date = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}`;
  return {
    id: `s-${start}-${idSuffix}`,
    startTime: startDate.toISOString(),
    endTime: end.toISOString(),
    durationMinutes,
    date
  };
}

// sessionXP: 1h = 100 XP, fractional rounds to nearest int.
assert.equal(sessionXP(60), 100);
assert.equal(sessionXP(30), 50);
assert.equal(sessionXP(90), 150);

// levelFromXP: 500 XP per level, Level 1 starts at 0.
assert.equal(levelFromXP(0).currentLevel, 1);
assert.equal(levelFromXP(499).currentLevel, 1);
assert.equal(levelFromXP(500).currentLevel, 2);
assert.equal(levelFromXP(999).currentLevel, 2);
assert.equal(levelFromXP(2500).currentLevel, 6);
assert.equal(levelFromXP(750).xpIntoLevel, 250);
assert.equal(levelFromXP(750).xpToNextLevel, 250);

// XP events: one session in a day → session XP + 1 daily bonus, no weekly yet.
const oneSession = [mkSession("2026-05-25T10:00:00", 60)];
const oneSessionEvents = buildXPEvents(oneSession);
assert.equal(oneSessionEvents.filter((e) => e.type === "session").length, 1);
assert.equal(oneSessionEvents.filter((e) => e.type === "daily_streak_bonus").length, 1);
assert.equal(oneSessionEvents.filter((e) => e.type === "weekly_milestone_bonus").length, 0);
assert.equal(oneSessionEvents.find((e) => e.type === "daily_streak_bonus")?.amount, DAILY_STREAK_BONUS);

// Two sessions same day → only one daily bonus.
const sameDay = [
  mkSession("2026-05-25T10:00:00", 30, "a"),
  mkSession("2026-05-25T14:00:00", 45, "b")
];
const sameDayEvents = buildXPEvents(sameDay);
assert.equal(sameDayEvents.filter((e) => e.type === "daily_streak_bonus").length, 1);

// 5 different days in same ISO week → one weekly milestone bonus.
const week = [
  mkSession("2026-05-25T10:00:00", 30, "mon"), // Mon
  mkSession("2026-05-26T10:00:00", 30, "tue"),
  mkSession("2026-05-27T10:00:00", 30, "wed"),
  mkSession("2026-05-28T10:00:00", 30, "thu"),
  mkSession("2026-05-29T10:00:00", 30, "fri")
];
const weekEvents = buildXPEvents(week);
assert.equal(weekEvents.filter((e) => e.type === "weekly_milestone_bonus").length, 1);
assert.equal(
  weekEvents.find((e) => e.type === "weekly_milestone_bonus")?.amount,
  WEEKLY_MILESTONE_BONUS
);

// A 6th day in the same week does NOT add a second weekly bonus.
const weekPlusOne = [
  ...week,
  mkSession("2026-05-30T10:00:00", 30, "sat")
];
const weekPlusOneEvents = buildXPEvents(weekPlusOne);
assert.equal(
  weekPlusOneEvents.filter((e) => e.type === "weekly_milestone_bonus").length,
  1
);

// computeStreaks: 3 consecutive days ending today.
const today = new Date("2026-05-28T12:00:00");
const streakSessions = [
  mkSession("2026-05-26T10:00:00", 30, "a"),
  mkSession("2026-05-27T10:00:00", 30, "b"),
  mkSession("2026-05-28T10:00:00", 30, "c")
];
const { currentStreak, longestStreak } = computeStreaks(streakSessions, today);
assert.equal(currentStreak, 3);
assert.equal(longestStreak, 3);

// Gap breaks the streak.
const gapSessions = [
  mkSession("2026-05-20T10:00:00", 30, "a"),
  mkSession("2026-05-21T10:00:00", 30, "b"),
  mkSession("2026-05-28T10:00:00", 30, "c")
];
const gap = computeStreaks(gapSessions, today);
assert.equal(gap.currentStreak, 1);
assert.equal(gap.longestStreak, 2);

// deriveProgress totals.
const derived = deriveProgress(week, null, new Date("2026-05-29T20:00:00"));
// 5 sessions × 30 min = 150 min = 2.5 hours
assert.equal(derived.totalHours, 2.5);
assert.equal(derived.totalSessions, 5);
// XP: 5 × 50 (sessions) + 5 × 25 (daily bonuses) + 250 (weekly) = 250 + 125 + 250 = 625
assert.equal(derived.totalXP, 625);
assert.equal(derived.currentLevel, 2); // 625 / 500 = 1, +1 = level 2
assert.equal(derived.bonusThisWeek, true);

console.log("progress calculation tests passed");
