"use client";

import { useState } from "react";
import { Clock, Hash, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { SessionTimer } from "./session-timer";
import { XPProgressBar } from "./xp-progress-bar";
import { StreakCard } from "./streak-card";
import { WeeklyChart } from "./weekly-chart";
import { SessionHistory } from "./session-history";
import { BadgeGrid } from "./badge-grid";
import { ResetDataModal } from "./reset-data-modal";
import { useProgressTracker } from "./use-progress-tracker";
import { prettyDateTime } from "@/lib/progress/date-utils";

const microcopy = [
  "Momentum compounds.",
  "Another brick in the empire.",
  "Build streak active.",
  "Founder mode engaged."
];

export function ProgressTrackerPage() {
  const {
    loading,
    progress,
    liveElapsedSeconds,
    startSession,
    endSession,
    cancelActiveSession,
    deleteSession,
    updateSession,
    resetAll
  } = useProgressTracker();
  const [resetOpen, setResetOpen] = useState(false);

  const tagline = microcopy[progress.currentStreak % microcopy.length];

  return (
    <div className="flex flex-col gap-6 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-[var(--muted-foreground)]">Colateral AI</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Founder progress tracker</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{tagline}</p>
        </div>
        <Button variant="ghost" onClick={() => setResetOpen(true)}>
          Reset all data
        </Button>
      </header>

      {progress.activeSession && progress.activeSession.startTime &&
        liveElapsedSeconds > 6 * 60 * 60 && (
          <Card className="border-yellow-300/20 bg-yellow-500/5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-yellow-100">
                  This session has been running for {(liveElapsedSeconds / 3600).toFixed(1)} hours.
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Started {prettyDateTime(progress.activeSession.startTime)}. End it now if you forgot.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={cancelActiveSession}>
                  Discard
                </Button>
                <Button variant="primary" onClick={endSession}>
                  End now
                </Button>
              </div>
            </div>
          </Card>
        )}

      <SessionTimer
        active={progress.activeSession !== null}
        startTime={progress.activeSession?.startTime ?? null}
        elapsedSeconds={liveElapsedSeconds}
        onStart={startSession}
        onEnd={endSession}
      />

      <XPProgressBar
        level={progress.currentLevel}
        xpIntoLevel={progress.xpIntoLevel}
        xpToNextLevel={progress.xpToNextLevel}
        percent={progress.levelProgressPercent}
        totalXP={progress.totalXP}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total hours"
          value={progress.totalHours.toFixed(2)}
          detail="Independent of XP"
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          label="Sessions"
          value={progress.totalSessions.toString()}
          detail="All-time completed"
          icon={<Hash className="h-5 w-5" />}
        />
        <StatCard
          label="Total XP"
          value={progress.totalXP.toLocaleString()}
          detail={`Level ${progress.currentLevel}`}
          icon={<Zap className="h-5 w-5" />}
        />
        <StatCard
          label="Longest streak"
          value={`${progress.longestStreak}d`}
          detail={progress.currentStreak > 0 ? `Current: ${progress.currentStreak}d` : "Reignite today"}
          icon={<Sparkles className="h-5 w-5" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StreakCard
          currentStreak={progress.currentStreak}
          longestStreak={progress.longestStreak}
          bonusToday={progress.bonusToday}
          bonusThisWeek={progress.bonusThisWeek}
        />
        <div className="lg:col-span-2">
          <WeeklyChart data={progress.weekly} />
        </div>
      </div>

      <SessionHistory
        sessions={progress.sessions}
        onUpdate={updateSession}
        onDelete={deleteSession}
      />

      <BadgeGrid badges={progress.badges} />

      <ResetDataModal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={() => {
          resetAll();
          setResetOpen(false);
        }}
      />

      {loading && (
        <p className="text-center text-xs text-[var(--muted-foreground)]">Loading…</p>
      )}
    </div>
  );
}
