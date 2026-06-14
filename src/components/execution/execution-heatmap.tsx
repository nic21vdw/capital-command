"use client";

import { useMemo } from "react";
import type { HeatmapCell } from "@/lib/execution/calculations";
import { type LocalDate, addDays, formatLongDate, parseLocalDate, weekStart } from "@/lib/execution/dates";

const LEVEL_STYLES: Record<number, string> = {
  0: "bg-white/5",
  1: "bg-[var(--accent)]/25",
  2: "bg-[var(--accent)]/45",
  3: "bg-[var(--accent)]/70",
  4: "bg-[var(--accent)]"
};

const WEEKDAY_ROWS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];

interface Column {
  weekStart: LocalDate;
  cells: (HeatmapCell | null)[];
}

/**
 * GitHub-style contribution heatmap. Cells are bucketed into Monday-anchored
 * week columns; the first column is left-padded so each cell sits on its correct
 * day-of-week row. Intensity comes from a normalized completion score so that
 * one high-volume goal cannot dominate the colour.
 */
export function ExecutionHeatmap({ cells }: { cells: HeatmapCell[] }) {
  const { columns, monthLabels } = useMemo(() => buildColumns(cells), [cells]);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto pb-2">
        <div className="inline-flex flex-col gap-2">
          {/* Month labels */}
          <div className="flex gap-[3px] pl-9 text-[10px] text-[var(--muted-foreground)]">
            {columns.map((column, index) => (
              <div key={column.weekStart} className="w-[13px] shrink-0">
                {monthLabels[index] ?? ""}
              </div>
            ))}
          </div>
          <div className="flex gap-[3px]">
            {/* Weekday row labels */}
            <div className="mr-1 flex w-8 shrink-0 flex-col gap-[3px] text-[10px] text-[var(--muted-foreground)]">
              {WEEKDAY_ROWS.map((label, index) => (
                <div key={index} className="flex h-[13px] items-center">
                  {label}
                </div>
              ))}
            </div>
            {columns.map((column) => (
              <div key={column.weekStart} className="flex flex-col gap-[3px]">
                {column.cells.map((cell, rowIndex) =>
                  cell ? (
                    <div
                      key={cell.date}
                      className={`h-[13px] w-[13px] rounded-[3px] ${LEVEL_STYLES[cell.level]}`}
                      title={tooltipFor(cell)}
                      aria-label={tooltipFor(cell)}
                    />
                  ) : (
                    <div key={`empty-${column.weekStart}-${rowIndex}`} className="h-[13px] w-[13px] rounded-[3px]" />
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span key={level} className={`h-[12px] w-[12px] rounded-[3px] ${LEVEL_STYLES[level]}`} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

function tooltipFor(cell: HeatmapCell): string {
  const noun = cell.count === 1 ? "completion" : "completions";
  if (cell.count === 0) {
    return `No activity on ${formatLongDate(cell.date)}`;
  }
  return `${cell.count} ${noun} on ${formatLongDate(cell.date)} — ${Math.round(cell.score * 100)}% of daily target`;
}

function buildColumns(cells: HeatmapCell[]): { columns: Column[]; monthLabels: (string | null)[] } {
  if (cells.length === 0) return { columns: [], monthLabels: [] };

  const byDate = new Map(cells.map((cell) => [cell.date, cell]));
  const first = cells[0].date;
  const last = cells[cells.length - 1].date;

  const columns: Column[] = [];
  let columnStart = weekStart(first);
  while (columnStart <= last) {
    const weekCells: (HeatmapCell | null)[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = addDays(columnStart, day);
      if (date < first || date > last) {
        weekCells.push(null);
      } else {
        weekCells.push(byDate.get(date) ?? { date, count: 0, score: 0, level: 0 });
      }
    }
    columns.push({ weekStart: columnStart, cells: weekCells });
    columnStart = addDays(columnStart, 7);
  }

  // Month labels: render when a column's month differs from the previous one.
  const monthLabels: (string | null)[] = columns.map((column, index) => {
    const month = parseLocalDate(column.weekStart).toLocaleDateString("en-CA", { month: "short" });
    if (index === 0) return month;
    const prevMonth = parseLocalDate(columns[index - 1].weekStart).toLocaleDateString("en-CA", { month: "short" });
    return month !== prevMonth ? month : null;
  });

  return { columns, monthLabels };
}
