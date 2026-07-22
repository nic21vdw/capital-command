"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flame,
  Minus,
  Plus,
  Settings2,
  Sparkles,
  TrendingUp
} from "lucide-react";
import { useAppData } from "@/components/providers/app-provider";
import { ExecutionHeatmap } from "@/components/execution/execution-heatmap";
import { GoalManager } from "@/components/execution/goal-manager";
import { resolveExecutionIcon } from "@/components/execution/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { type StreakResult } from "@/lib/execution/calculations";
import { formatLongDate, formatWeekRange, todayLocal, weekdayLabel } from "@/lib/execution/dates";
import {
  type CategoryView,
  type DebtView,
  type ExecutionView,
  type TodayTask,
  type WeekSummary,
  type WeeklyGoalView,
  buildExecutionView
} from "@/lib/execution/view-model";
import { cn } from "@/lib/utils";
import type { ExecutionCompletion } from "@/types/domain";

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

export function ExecutionPage() {
  const { data, mutate, loading } = useAppData();
  const [today] = useState(() => todayLocal());
  const [managerOpen, setManagerOpen] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const reconciledRef = useRef(false);

  // Reconcile ended weeks using the *client's* local date once data is present.
  // The server already reconciles on load; this corrects any timezone-edge case
  // where the server's idea of "today" differs from the user's.
  useEffect(() => {
    if (reconciledRef.current) return;
    if (loading) return;
    if (data.executionGoals.length === 0) return;
    reconciledRef.current = true;
    void mutate("reconcileExecution", { today });
  }, [loading, data.executionGoals.length, mutate, today]);

  const view = useMemo(() => buildExecutionView(data, today), [data, today]);

  // Index this week's completions per goal so cards can show/undo entries.
  const weekEntriesByGoal = useMemo(() => {
    const map = new Map<string, ExecutionCompletion[]>();
    for (const entry of data.executionCompletions) {
      if (entry.date < view.weekStart || entry.date > view.weekEnd) continue;
      const list = map.get(entry.goalId) ?? [];
      list.push(entry);
      map.set(entry.goalId, list);
    }
    for (const list of map.values()) list.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return map;
  }, [data.executionCompletions, view.weekStart, view.weekEnd]);

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy[key]) return;
    setBusy((state) => ({ ...state, [key]: true }));
    try {
      await fn();
    } finally {
      setBusy((state) => ({ ...state, [key]: false }));
    }
  };

  const logOne = (goalId: string, date: string) =>
    run(`${goalId}:${date}`, () => mutate("logCompletion", { goalId, date, today }));

  const undoOne = (goalId: string, id: string, key: string) =>
    run(key, () => mutate("undoCompletion", { id, today }));

  if (loading && data.executionGoals.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Execution" title="Execution" description="Loading your accountability dashboard…" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-[28px]" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-[28px]" />
      </div>
    );
  }

  if (!view.hasGoals) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Execution"
          title="Execution"
          description="Recurring content, networking, and build goals with streaks and carry-forward debt."
        />
        <Card className="flex flex-col items-center gap-4 py-16 text-center">
          <span className="rounded-2xl bg-white/6 p-4 text-[var(--accent)]">
            <Sparkles className="h-6 w-6" />
          </span>
          <div>
            <p className="text-lg font-semibold text-white">No goals yet</p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">Seed the default recurring goals to get started.</p>
          </div>
          <Button onClick={() => void mutate("seedExecution", { today }, { successMessage: "Default goals created." })}>
            Create default goals
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Execution"
        title="Execution"
        description={`Week of ${formatWeekRange(view.weekStart)} · ${formatLongDate(today)}`}
        actions={
          <Button variant="secondary" onClick={() => setManagerOpen(true)}>
            <Settings2 className="mr-2 h-4 w-4" />
            Manage goals
          </Button>
        }
      />

      <SummaryCards view={view} />

      <TodaySection
        tasks={view.todayTasks}
        today={today}
        busy={busy}
        onLog={logOne}
        onUndo={(goalId, key) => {
          const latest = (weekEntriesByGoal.get(goalId) ?? []).find((entry) => entry.date === today);
          if (latest) void undoOne(goalId, latest.id, key);
        }}
      />

      <WeeklyGoalsSection
        goals={view.weeklyGoals}
        today={today}
        entriesByGoal={weekEntriesByGoal}
        busy={busy}
        onLog={logOne}
        onUndoLatest={(goalId, key) => {
          const latest = (weekEntriesByGoal.get(goalId) ?? [])[0];
          if (latest) void undoOne(goalId, latest.id, key);
        }}
        onUndoEntry={(goalId, id) => void undoOne(goalId, id, `${goalId}:entry:${id}`)}
      />

      <CategorySummary categories={view.categories} />

      <div className="grid gap-6 xl:grid-cols-2">
        <DebtPanel debts={view.debts} />
        <StreaksPanel summary={view.summary} />
      </div>

      <Card>
        <SectionTitle title="Activity" subtitle="Normalized daily execution over the last 12 months." />
        <ExecutionHeatmap cells={view.heatmap} />
      </Card>

      <WeeklyHistory weeks={view.weeks} />

      <GoalManager open={managerOpen} onClose={() => setManagerOpen(false)} />
    </div>
  );
}

function SectionTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-[var(--muted-foreground)]">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

function streakLabel(streak: StreakResult): string {
  return `${streak.current} day${streak.current === 1 ? "" : "s"}`;
}

function SummaryCards({ view }: { view: ExecutionView }) {
  const { summary } = view;
  const cards = [
    { label: "Today", value: pct(summary.todayPercent), detail: "Daily tasks completed", icon: <CheckCircle2 className="h-5 w-5" /> },
    { label: "This week", value: pct(summary.weekPercent), detail: "Baseline completion", icon: <TrendingUp className="h-5 w-5" /> },
    {
      label: "Outstanding debt",
      value: String(summary.outstandingDebt),
      detail: summary.outstandingDebt === 0 ? "All caught up" : "Items carried forward",
      icon: <Flame className="h-5 w-5" />
    },
    {
      label: "Current streak",
      value: streakLabel(summary.activeStreak),
      detail: "Consecutive active days",
      icon: <Flame className="h-5 w-5" />,
      tooltip: "Active day: at least one tracked completion was recorded."
    },
    {
      label: "Longest streak",
      value: `${summary.activeStreak.longest} days`,
      detail: "Best active-day run",
      icon: <Sparkles className="h-5 w-5" />
    },
    {
      label: "Completions",
      value: String(summary.totalCompletionsThisWeek),
      detail: "Logged this week",
      icon: <CheckCircle2 className="h-5 w-5" />
    }
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.label} title={card.tooltip}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-[var(--muted-foreground)]">{card.label}</p>
              <p className="mt-2 text-3xl font-semibold text-white">{card.value}</p>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">{card.detail}</p>
            </div>
            <div className="rounded-2xl bg-white/6 p-3 text-[var(--accent)]">{card.icon}</div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function TodaySection({
  tasks,
  today,
  busy,
  onLog,
  onUndo
}: {
  tasks: TodayTask[];
  today: string;
  busy: Record<string, boolean>;
  onLog: (goalId: string, date: string) => void;
  onUndo: (goalId: string, key: string) => void;
}) {
  if (tasks.length === 0) {
    return (
      <Card>
        <SectionTitle title="Today" subtitle={weekdayLabel(today)} />
        <p className="text-sm text-[var(--muted-foreground)]">No daily tasks scheduled. Your weekly goals are below.</p>
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle title="Today" subtitle={`${weekdayLabel(today)} · ${tasks.filter((t) => t.met).length} of ${tasks.length} tasks done`} />
      <div className="space-y-3">
        {tasks.map((task) => {
          const Icon = resolveExecutionIcon(task.goal.icon);
          const key = `${task.goal.id}:${today}`;
          const units = Math.max(task.required, task.completed);
          return (
            <div
              key={task.goal.id}
              className={cn(
                "flex flex-col gap-3 rounded-2xl border border-white/8 bg-[var(--well)] p-4 sm:flex-row sm:items-center sm:justify-between",
                task.met && "border-[var(--accent)]/40"
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className={cn("rounded-xl p-2", task.met ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "bg-white/6 text-[var(--accent)]")}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-white">{task.goal.title}</p>
                    {task.hasDebt ? <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-200">debt</Badge> : null}
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {task.goal.category} · {task.completed} of {task.required} completed today
                    {task.completed > task.required ? ` (+${task.completed - task.required} extra)` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {Array.from({ length: units }).map((_, index) => {
                    const filled = index < task.completed;
                    const isNextEmpty = index === task.completed;
                    const isLastFilled = index === task.completed - 1;
                    const interactive = isNextEmpty || isLastFilled;
                    return (
                      <button
                        key={index}
                        type="button"
                        disabled={busy[key] || !interactive}
                        aria-label={filled ? "Undo completion" : "Mark complete"}
                        onClick={() => (filled ? onUndo(task.goal.id, key) : onLog(task.goal.id, today))}
                        className={cn(
                          "h-6 w-6 rounded-lg border transition",
                          filled
                            ? "border-[var(--accent)] bg-[var(--accent)]"
                            : "border-white/15 bg-transparent hover:border-[var(--accent)]/60",
                          index >= task.required && filled && "border-amber-300 bg-amber-300",
                          !interactive && "cursor-default opacity-70"
                        )}
                      />
                    );
                  })}
                </div>
                <Button variant="secondary" className="px-3" disabled={busy[key]} aria-label="Log extra" onClick={() => onLog(task.goal.id, today)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function SegmentedBar({ goal }: { goal: WeeklyGoalView }) {
  const { breakdown } = goal;
  const total = Math.max(1, breakdown.effectiveRequired);
  const basePct = (breakdown.baseline / total) * 100;
  const debtPct = (breakdown.startingDebt / total) * 100;
  const baseFill = breakdown.baseline === 0 ? 0 : (breakdown.baselineCompleted / breakdown.baseline) * 100;
  const debtFill = breakdown.startingDebt === 0 ? 0 : (breakdown.debtPaid / breakdown.startingDebt) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex h-2.5 w-full gap-1 overflow-hidden rounded-full">
        <div className="h-full overflow-hidden rounded-full bg-white/8" style={{ flexBasis: `${basePct}%` }}>
          <div className="h-full rounded-full bg-[var(--accent)] transition-[width]" style={{ width: `${baseFill}%` }} />
        </div>
        {breakdown.startingDebt > 0 ? (
          <div className="h-full overflow-hidden rounded-full bg-white/8" style={{ flexBasis: `${debtPct}%` }} title="Carried-forward debt">
            <div className="h-full rounded-full bg-amber-400 transition-[width]" style={{ width: `${debtFill}%` }} />
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
        <span>
          <span className="text-[var(--accent)]">■</span> Baseline
          {breakdown.startingDebt > 0 ? (
            <>
              {" "}
              · <span className="text-amber-400">■</span> Debt
            </>
          ) : null}
        </span>
        {breakdown.overachievement > 0 ? (
          <span className="font-medium text-[var(--accent)]">+{breakdown.overachievement} ahead</span>
        ) : null}
      </div>
    </div>
  );
}

function WeeklyGoalsSection({
  goals,
  today,
  entriesByGoal,
  busy,
  onLog,
  onUndoLatest,
  onUndoEntry
}: {
  goals: WeeklyGoalView[];
  today: string;
  entriesByGoal: Map<string, ExecutionCompletion[]>;
  busy: Record<string, boolean>;
  onLog: (goalId: string, date: string) => void;
  onUndoLatest: (goalId: string, key: string) => void;
  onUndoEntry: (goalId: string, id: string) => void;
}) {
  return (
    <div>
      <SectionTitle title="Weekly goals" subtitle="Baseline, carried debt, and overachievement — tracked separately." />
      <div className="grid gap-4 xl:grid-cols-2">
        {goals.map((view) => {
          const goal = view.goal;
          const b = view.breakdown;
          const Icon = resolveExecutionIcon(goal.icon);
          const key = `${goal.id}:week`;
          const entries = entriesByGoal.get(goal.id) ?? [];
          return (
            <Card key={goal.id} className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="rounded-xl bg-white/6 p-2 text-[var(--accent)]">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{goal.title}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">{goal.category}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-white">
                    {b.completed}
                    <span className="text-base font-normal text-[var(--muted-foreground)]"> / {b.effectiveRequired}</span>
                  </p>
                  <p className="text-[11px] text-[var(--muted-foreground)]">{b.successful ? "baseline met" : `${b.remainingBaseline} to baseline`}</p>
                </div>
              </div>

              <SegmentedBar goal={view} />

              <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs sm:grid-cols-6">
                <Stat label="Baseline" value={b.baseline} />
                <Stat label="Start debt" value={b.startingDebt} accent={b.startingDebt > 0 ? "amber" : undefined} />
                <Stat label="Required" value={b.effectiveRequired} />
                <Stat label="Done" value={b.completed} />
                <Stat label="Debt paid" value={b.debtPaid} accent={b.debtPaid > 0 ? "amber" : undefined} />
                <Stat label="Extra" value={b.overachievement} accent={b.overachievement > 0 ? "accent" : undefined} />
              </dl>

              {goal.frequency === "daily" ? (
                <div className="flex flex-wrap gap-1.5">
                  {view.days.map((day) => (
                    <span
                      key={day.date}
                      title={`${formatLongDate(day.date)} — ${day.completed}/${day.target}`}
                      className={cn(
                        "flex h-7 min-w-7 items-center justify-center rounded-lg border px-1 text-[10px]",
                        day.isFuture
                          ? "border-white/8 text-[var(--muted-foreground)]"
                          : day.met
                            ? "border-[var(--accent)]/50 bg-[var(--accent)]/15 text-[var(--accent)]"
                            : day.missed
                              ? "border-amber-400/30 bg-amber-400/5 text-amber-200/80"
                              : "border-white/15 text-white",
                        day.isToday && "ring-1 ring-[var(--accent)]"
                      )}
                    >
                      {weekdayLabel(day.date)[0]}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    className="px-3"
                    aria-label="Undo last completion"
                    disabled={busy[key] || entries.length === 0}
                    onClick={() => onUndoLatest(goal.id, key)}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Button variant="primary" className="px-3" aria-label="Log a completion" disabled={busy[key]} onClick={() => onLog(goal.id, today)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {entries.length > 0 ? (
                  <details className="text-right">
                    <summary className="cursor-pointer list-none text-xs text-[var(--muted-foreground)] hover:text-white">
                      {entries.length} entr{entries.length === 1 ? "y" : "ies"} this week
                    </summary>
                    <div className="mt-2 max-h-40 space-y-1 overflow-y-auto text-left">
                      {entries.map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--well)] px-2 py-1 text-xs">
                          <span className="text-[var(--muted-foreground)]">
                            {weekdayLabel(entry.date)} {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <button
                            type="button"
                            className="text-[var(--muted-foreground)] hover:text-red-300"
                            onClick={() => onUndoEntry(goal.id, entry.id)}
                          >
                            remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: "amber" | "accent" }) {
  return (
    <div>
      <dt className="text-[var(--muted-foreground)]">{label}</dt>
      <dd
        className={cn(
          "font-semibold text-white",
          accent === "amber" && "text-amber-300",
          accent === "accent" && "text-[var(--accent)]"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function CategorySummary({ categories }: { categories: CategoryView[] }) {
  return (
    <div>
      <SectionTitle title="Categories" subtitle="Baseline completion across each area." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {categories.map((category) => (
          <Card key={category.category} className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-white">{category.category}</p>
              <span className="text-sm font-semibold text-[var(--accent)]">{pct(category.percent)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, category.percent)}%` }} />
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              {category.baselineCompleted} of {category.baseline} baseline · {category.goalCount} goal{category.goalCount === 1 ? "" : "s"}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}

function DebtPanel({ debts }: { debts: DebtView[] }) {
  return (
    <Card>
      <SectionTitle title="Outstanding debt" subtitle="Missed baseline work carried into this week." />
      {debts.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4">
          <CheckCircle2 className="h-5 w-5 text-[var(--accent)]" />
          <p className="text-sm text-white">No outstanding debt. Every baseline is current.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {debts.map((debt) => {
            const Icon = resolveExecutionIcon(debt.goal.icon);
            return (
              <div key={debt.goal.id} className="rounded-2xl border border-white/8 bg-[var(--well)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="rounded-xl bg-amber-400/10 p-2 text-amber-300">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{debt.goal.title}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {debt.oldestWeek ? `Oldest: week of ${formatWeekRange(debt.oldestWeek)}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-semibold text-amber-300">{debt.total}</p>
                    {debt.repaidThisWeek > 0 ? <p className="text-[11px] text-[var(--accent)]">{debt.repaidThisWeek} repaid</p> : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {debt.byWeek.map((week) => (
                    <span
                      key={week.originWeekStart}
                      title={`${week.remaining} of ${week.original} from week of ${formatWeekRange(week.originWeekStart)}`}
                      className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-2 py-1 text-[11px] text-amber-200/90"
                    >
                      {week.remaining} · {formatWeekRange(week.originWeekStart).split(" – ")[0]}
                    </span>
                  ))}
                </div>
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
                    <span>Debt cap {debt.cap}</span>
                    <span>{pct(debt.percentOfCap)} of cap</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={cn("h-full rounded-full", debt.percentOfCap >= 80 ? "bg-red-400" : "bg-amber-400")}
                      style={{ width: `${Math.min(100, debt.percentOfCap)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function StreaksPanel({ summary }: { summary: ExecutionView["summary"] }) {
  const rows = [
    {
      label: "Active-day streak",
      streak: summary.activeStreak,
      definition: "Active day: at least one tracked completion was recorded."
    },
    {
      label: "Perfect-day streak",
      streak: summary.perfectStreak,
      definition: "Perfect day: every daily task assigned to that day was completed."
    },
    {
      label: "Successful-week streak",
      streak: summary.weeklyStreak,
      definition: "Successful week: all baseline weekly requirements were met. Debt repayment is tracked separately."
    }
  ];
  return (
    <Card>
      <SectionTitle title="Streaks" subtitle="Hover a row for its exact definition." />
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-[var(--well)] p-4" title={row.definition}>
            <div className="flex items-center gap-3">
              <Flame className="h-5 w-5 text-[var(--accent)]" />
              <div>
                <p className="text-sm font-medium text-white">{row.label}</p>
                <p className="text-xs text-[var(--muted-foreground)]">Longest: {row.streak.longest}</p>
              </div>
            </div>
            <p className="text-2xl font-semibold text-white">{row.streak.current}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function WeeklyHistory({ weeks }: { weeks: WeekSummary[] }) {
  const [index, setIndex] = useState(0);
  if (weeks.length === 0) return null;
  const safeIndex = Math.min(index, weeks.length - 1);
  const week = weeks[safeIndex];

  return (
    <Card>
      <SectionTitle
        title="Weekly history"
        subtitle="Snapshots stay accurate even if goal targets change later."
        right={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="px-2"
              aria-label="Newer week"
              disabled={safeIndex === 0}
              onClick={() => setIndex((value) => Math.max(0, value - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-40 text-center text-sm text-white">{formatWeekRange(week.weekStart)}</span>
            <Button
              variant="ghost"
              className="px-2"
              aria-label="Older week"
              disabled={safeIndex >= weeks.length - 1}
              onClick={() => setIndex((value) => Math.min(weeks.length - 1, value + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {week.isCurrent ? <Badge className="border-white/15 bg-white/6 text-white">In progress</Badge> : null}
        <Badge
          className={cn(
            week.successful
              ? "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]"
              : "border-amber-400/30 bg-amber-400/10 text-amber-200"
          )}
        >
          {week.successful ? "Successful week" : "Baseline missed"}
        </Badge>
        <span className="text-sm text-[var(--muted-foreground)]">{pct(week.percent)} of baseline</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <Stat label="Baseline" value={week.baselineRequired} />
        <Stat label="Start debt" value={week.startingDebt} accent={week.startingDebt > 0 ? "amber" : undefined} />
        <Stat label="Completed" value={week.completed} />
        <Stat label="Baseline done" value={week.baselineCompleted} />
        <Stat label="Debt repaid" value={week.debtRepaid} accent={week.debtRepaid > 0 ? "amber" : undefined} />
        <Stat label="New debt" value={week.newDebt} accent={week.newDebt > 0 ? "amber" : undefined} />
        <Stat label="Ending debt" value={week.endingDebt} accent={week.endingDebt > 0 ? "amber" : undefined} />
        <Stat label="Extra" value={week.overachievement} accent={week.overachievement > 0 ? "accent" : undefined} />
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-[var(--muted-foreground)]">
            <tr>
              {["Goal", "Baseline", "Start debt", "Done", "Debt paid", "New debt", "End debt", "Extra"].map((label) => (
                <th key={label} className="border-b border-white/8 px-3 py-2 text-left font-normal">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {week.rows.map((row) => (
              <tr key={row.goal.id} className="border-b border-white/6">
                <td className="px-3 py-2 text-white">{row.goal.title}</td>
                <td className="px-3 py-2 text-[var(--muted-foreground)]">{row.baseline}</td>
                <td className="px-3 py-2 text-[var(--muted-foreground)]">{row.startingDebt}</td>
                <td className="px-3 py-2 text-white">{row.completed}</td>
                <td className="px-3 py-2 text-amber-300">{row.debtPaid}</td>
                <td className="px-3 py-2 text-amber-300">{row.newDebt}</td>
                <td className="px-3 py-2 text-amber-300">{row.endingDebt}</td>
                <td className="px-3 py-2 text-[var(--accent)]">{row.overachievement}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
