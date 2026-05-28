"use client";

import { Flame, Calendar, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";

export function StreakCard({
  currentStreak,
  longestStreak,
  bonusToday,
  bonusThisWeek
}: {
  currentStreak: number;
  longestStreak: number;
  bonusToday: boolean;
  bonusThisWeek: boolean;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-[var(--muted-foreground)]">Streak</p>
          <p
            className="mt-2 text-4xl font-semibold text-white"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {currentStreak}
            <span className="ml-1 text-lg text-[var(--muted-foreground)]">days</span>
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {currentStreak > 0 ? "Build streak active" : "Start the streak today"}
          </p>
        </div>
        <div className="rounded-2xl bg-white/6 p-3 text-[var(--accent)]">
          <Flame className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
          <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
            <Trophy className="h-3.5 w-3.5" />
            Longest
          </div>
          <p className="mt-1 text-lg font-semibold text-white" style={{ fontVariantNumeric: "tabular-nums" }}>
            {longestStreak} days
          </p>
        </div>
        <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
          <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
            <Calendar className="h-3.5 w-3.5" />
            Bonuses
          </div>
          <p className="mt-1 text-sm font-medium text-white">
            <span className={bonusToday ? "text-[var(--accent)]" : "text-[var(--muted-foreground)]"}>
              {bonusToday ? "+25 today" : "Daily pending"}
            </span>
            <span className="mx-2 text-[var(--muted-foreground)]">·</span>
            <span className={bonusThisWeek ? "text-[var(--accent)]" : "text-[var(--muted-foreground)]"}>
              {bonusThisWeek ? "+250 week" : "Weekly pending"}
            </span>
          </p>
        </div>
      </div>
    </Card>
  );
}
