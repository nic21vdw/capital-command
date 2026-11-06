"use client";

import { Loader2 } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { AccountSlots, Confidence, SlotSuggestion } from "@/lib/analytics/bestTimes";
import { MIN_POSTS_PER_ACCOUNT, SLOT_AGE_HOURS } from "@/lib/analytics/bestTimes";
import type { BestTimesResponse } from "@/lib/analytics/bestTimesApi";
import { accountOptionKey, accountOptionLabel, suggestionAvailable } from "@/lib/analytics/bestTimesView";
import { USE_SLOTS_HINT } from "@/lib/analytics/surface";
import { formatClockTime } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";

const CONFIDENCE_TONE: Record<Confidence, BadgeTone> = { low: "warning", medium: "info", high: "success" };

function times(list: string[]): string {
  return list.map(formatClockTime).join(", ");
}

function hourLabel(hour: number): string {
  return formatClockTime(`${String(hour).padStart(2, "0")}:00`);
}

function SuggestionRow({ label, suggestion }: { label: string; suggestion: SlotSuggestion }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-[var(--border)] px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-white">{label}</p>
        {suggestion.confidence ? <Badge tone={CONFIDENCE_TONE[suggestion.confidence]}>{suggestion.confidence} confidence</Badge> : null}
      </div>
      {suggestion.status === "ready" ? (
        <>
          <p className="text-sm text-white">
            <span className="text-[var(--muted-foreground)]">Now </span>
            {times(suggestion.current)}
          </p>
          <p className="text-sm text-white">
            <span className="text-[var(--muted-foreground)]">Suggested </span>
            <span className="font-semibold">{times(suggestion.times)}</span>
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            Based on {suggestion.basis}.
            {suggestion.gainPercent !== null ? ` About ${suggestion.gainPercent}% more views at ${SLOT_AGE_HOURS} hours than the current slots.` : ""}
          </p>
        </>
      ) : suggestion.status === "unchanged" ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          {times(suggestion.current)}. {suggestion.reason}
        </p>
      ) : (
        <>
          <p className="text-sm text-white">Not enough data yet</p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {(suggestion.reason ?? "").replace(/^Not enough data yet:\s*/i, "")} The slots stay as they are: {times(suggestion.current)}.
          </p>
        </>
      )}
    </div>
  );
}

function HourStrip({ suggestion }: { suggestion: SlotSuggestion }) {
  const hours = suggestion.hours.filter((stat) => stat.considered);
  if (hours.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="How each posting hour has done">
      {hours.map((stat) => (
        <li
          key={stat.hour}
          title={`${stat.posts} posts, ${Math.round(stat.meanViews).toLocaleString("en-US")} views on average at ${SLOT_AGE_HOURS} hours`}
          className={cn("rounded-full border px-2 py-0.5 text-[11px] tabular-nums", stat.smoothedLift >= 0 ? "tone-success tone-edge tone-text" : "border-[var(--border)] text-[var(--muted-foreground)]")}
        >
          {hourLabel(stat.hour)} {stat.smoothedLift >= 0 ? "+" : ""}
          {Math.round(stat.smoothedLift * 100)}%
        </li>
      ))}
    </ul>
  );
}

export function SuggestedSlotsCard({
  state,
  report,
  target,
  onTarget,
  applying,
  onApply
}: {
  state: "loading" | "ready" | "error";
  report: BestTimesResponse | null;
  target: string | null;
  onTarget: (key: string) => void;
  applying: boolean;
  onApply: () => void;
}) {
  const accounts = report?.accounts ?? [];
  const selected: AccountSlots | null = accounts.find((account) => accountOptionKey(account) === target) ?? null;
  const available = selected !== null && suggestionAvailable(selected);
  return (
    <section aria-label="Suggested slots" className="space-y-3">
      <h2 className="text-sm font-semibold text-white">Suggested slots</h2>
      <Card className="space-y-3 p-4">
        {state === "loading" ? (
          <p className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Learning from your posts
          </p>
        ) : null}
        {state === "error" ? <p className="text-sm text-[var(--muted-foreground)]">The suggestions could not be read. Reload the page to try again.</p> : null}
        {state === "ready" && !selected ? (
          <div className="space-y-1 text-sm">
            <p className="text-white">Not enough data yet</p>
            <p className="text-[var(--muted-foreground)]">
              The posting hours are learned from how each post did {SLOT_AGE_HOURS} hours after it went out, once an account has {MIN_POSTS_PER_ACCOUNT} such posts. Until then your
              slots stay exactly as they are{report ? `: ${times(report.current.weekday)} on weekdays, ${times(report.current.weekend)} on weekends` : ""}.
            </p>
          </div>
        ) : null}
        {state === "ready" && selected ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="max-w-prose text-xs text-[var(--muted-foreground)]">
                Learned from views {SLOT_AGE_HOURS} hours after posting, by the hour each post went out in {report?.timeZone}. Only hours you have already posted at can be compared.
              </p>
              {accounts.length > 1 ? (
                <>
                  <label className="sr-only" htmlFor="slots-account">
                    Suggested slots for
                  </label>
                  <Select id="slots-account" value={target ?? ""} onChange={(event) => onTarget(event.target.value)} className="h-9 w-auto min-w-44 text-xs">
                    {accounts.map((account) => (
                      <option key={accountOptionKey(account)} value={accountOptionKey(account)}>
                        {accountOptionLabel(account)}
                      </option>
                    ))}
                  </Select>
                </>
              ) : (
                <span className="text-xs text-white">{accountOptionLabel(selected)}</span>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <SuggestionRow label="Weekdays" suggestion={selected.weekday} />
              <SuggestionRow label="Weekends" suggestion={selected.weekend} />
            </div>
            <HourStrip suggestion={selected.weekday} />
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={onApply} disabled={!available || applying}>
                {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                Use these slots
              </Button>
              <p className="text-xs text-[var(--muted-foreground)]">{USE_SLOTS_HINT} Nothing changes until you press this.</p>
            </div>
          </>
        ) : null}
      </Card>
    </section>
  );
}
