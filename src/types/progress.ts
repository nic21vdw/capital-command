// Domain types for the Colateral progress tracker.
// Persisted shape is intentionally minimal: only `sessions` and the optional
// `activeSession` are stored. Stats, XP events, streaks, level — everything
// else is derived. That makes edit/delete operations trivially correct.

export interface Session {
  id: string;
  startTime: string; // ISO timestamp
  endTime: string; // ISO timestamp
  durationMinutes: number;
  date: string; // YYYY-MM-DD (local calendar day of startTime)
}

export interface ActiveSession {
  id: string;
  startTime: string; // ISO timestamp
}

export type XPEventType =
  | "session"
  | "daily_streak_bonus"
  | "weekly_milestone_bonus";

export interface XPEvent {
  id: string;
  type: XPEventType;
  amount: number;
  date: string; // YYYY-MM-DD
  description: string;
}

export interface ProgressStats {
  totalHours: number;
  totalSessions: number;
  currentStreak: number;
  longestStreak: number;
  totalXP: number;
  currentLevel: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  levelProgressPercent: number;
}

export interface PersistedProgress {
  sessions: Session[];
  activeSession: ActiveSession | null;
}

export interface DerivedProgress extends ProgressStats {
  sessions: Session[];
  xpEvents: XPEvent[];
  activeSession: ActiveSession | null;
  weekly: WeeklyAggregate[];
  bonusToday: boolean;
  bonusThisWeek: boolean;
  badges: Badge[];
}

export interface WeeklyAggregate {
  date: string; // YYYY-MM-DD
  label: string; // short weekday label
  hours: number;
  sessions: number;
}

export interface Badge {
  id: string;
  label: string;
  description: string;
  unlocked: boolean;
}
