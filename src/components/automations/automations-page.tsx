"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowUpRight, Clock3, Loader2, Pause, Play, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import type { AutomationCard, AutomationOverview } from "@/lib/automations/types";
import { cn } from "@/lib/utils";

const stateLabels = {
  paused: "Paused", blocked: "Blocked", running: "Running", ready: "Scheduled", attention: "Needs attention", unknown: "No run observed"
};

function at(value: string | null, timezone: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function AutomationPanel({ card, busy, stale, onPause }: {
  card: AutomationCard; busy: boolean; stale: boolean; onPause: (card: AutomationCard) => void;
}) {
  const needsAttention = card.state === "blocked" || card.state === "attention";
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white">{card.title}</h2>
            <span className={cn("rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide", needsAttention ? "bg-amber-500/10 text-amber-300" : card.paused ? "bg-white/10 text-[var(--muted-foreground)]" : "bg-[var(--accent)]/10 text-[var(--accent)]")}>
              {stale ? "Status unavailable" : stateLabels[card.state]}
            </span>
          </div>
          <p className="mt-1 max-w-lg text-sm text-[var(--muted-foreground)]">{card.description}</p>
        </div>
        <Button variant="secondary" disabled={busy || stale} onClick={() => onPause(card)} aria-label={`${card.paused ? "Resume" : "Pause"} ${card.title}`}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : card.paused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
          {card.paused ? "Resume" : "Pause"}
        </Button>
      </div>
      <div className="mt-5 flex flex-wrap gap-5">
        {card.counts.map((count) => <div key={count.label}><p className="text-2xl font-semibold tabular-nums text-white">{count.value}</p><p className="text-xs text-[var(--muted-foreground)]">{count.label}</p></div>)}
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--border)] pt-4 text-sm">
        <div className="col-span-2"><dt className="text-xs text-[var(--muted-foreground)]">Schedule</dt><dd className="mt-1 text-white">{card.schedule} <span className="text-[var(--muted-foreground)]">({card.timezone})</span></dd></div>
        <div><dt className="text-xs text-[var(--muted-foreground)]">Next check / delivery</dt><dd className="mt-1 text-white">{card.paused ? "Paused" : at(card.nextRunAt, card.timezone)}</dd></div>
        <div><dt className="text-xs text-[var(--muted-foreground)]">Next queued item</dt><dd className="mt-1 text-white">{at(card.nextItemAt, card.timezone)}</dd></div>
        <div><dt className="text-xs text-[var(--muted-foreground)]">Last worker evidence</dt><dd className="mt-1 text-white">{at(card.lastRunAt, card.timezone)}</dd></div>
        <div><dt className="text-xs text-[var(--muted-foreground)]">Last outcome</dt><dd className="mt-1 text-white">{card.lastOutcome ?? "No outcome recorded"}</dd></div>
      </dl>
      {card.taskLastRunAt && <p className="mt-3 text-xs text-[var(--muted-foreground)]">Windows task last started {at(card.taskLastRunAt, card.timezone)}; scheduler result {card.taskLastResult ?? "unknown"}. A task result does not confirm a post succeeded.</p>}
      {(card.blockers.length > 0 || card.issues.length > 0) && (
        <div className="mt-4 space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">
          {[...card.blockers, ...card.issues].map((issue, index) => <p key={`${index}-${issue}`} className="flex gap-2"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{issue}</p>)}
        </div>
      )}
      {card.id === "publisher" && <p className="mt-4 text-xs text-[var(--muted-foreground)]">Pause stops future worker actions. Posts already scheduled with a platform or Buffer can still go live; manage those posts on the platform. Explicit per-post Publish now remains available.</p>}
      {card.id === "podcast" && <p className="mt-4 text-xs text-[var(--muted-foreground)]">An episode in the feed has been handed off. Spotify decides when it becomes live; check its delivery on Podcast / Spotify.</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-[var(--muted-foreground)]">{card.changedAt ? `Control saved ${at(card.changedAt, card.timezone)}` : "No pause override saved"}</span>
        <Link href={card.href} className="inline-flex items-center gap-1 font-medium text-[var(--accent)]">Manage details <ArrowUpRight className="h-3.5 w-3.5" /></Link>
      </div>
    </section>
  );
}

export function AutomationsPage() {
  const [overview, setOverview] = useState<AutomationOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inflight = useRef(false);
  const changing = useRef(false);
  const load = useCallback(async () => {
    if (inflight.current || changing.current) return;
    inflight.current = true;
    setRefreshing(true);
    try {
      const response = await fetch("/api/automations", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Automation status could not be loaded.");
      setOverview(payload);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Automation status could not be loaded.");
    } finally {
      inflight.current = false;
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => { void load(); }, 0);
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 20_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [load]);

  async function change(id: string, body: object) {
    if (changing.current || inflight.current) return;
    changing.current = true;
    setBusy(id);
    try {
      const response = await fetch("/api/automations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Automation controls could not be saved.");
      if ("control" in payload) {
        setOverview((current) => current ? { ...current, cards: current.cards.map((card) => card.id === payload.id ? { ...card, ...payload.control, state: payload.control.paused ? "paused" : "unknown" } : card) } : current);
      } else {
        setOverview((current) => current ? { ...current, autoScheduleOvernight: payload.autoScheduleOvernight } : current);
      }
      toast.success("Automation control saved.");
      changing.current = false;
      await load();
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Automation controls could not be saved.");
    } finally {
      changing.current = false;
      setBusy(null);
    }
  }

  const blocked = overview?.cards.filter((card) => card.state === "blocked" || card.state === "attention").length ?? 0;
  const paused = overview?.cards.filter((card) => card.paused).length ?? 0;
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <PageHeader eyebrow="CoLateral Marketing" title="Automations" description="See what runs in the background, when it runs, what happened last and what needs fixing. Pause controls are saved and read by the workers." actions={<Button variant="secondary" onClick={() => void load()} disabled={refreshing || busy !== null}><RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />Refresh</Button>} />
      {error && <div role="alert" className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">Status is unavailable: {error} {overview ? "The last snapshot is shown below; controls are disabled until status returns." : "No worker status is assumed."}</div>}
      {!overview && !error && <p className="flex items-center gap-2 py-10 text-sm text-[var(--muted-foreground)]"><Loader2 className="h-4 w-4 animate-spin" />Loading saved controls and worker evidence...</p>}
      {overview && <>
        <div className="mb-5 flex flex-wrap gap-5 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
          <span className="inline-flex items-center gap-2 text-white"><Activity className="h-4 w-4 text-[var(--accent)]" />{overview.cards.length} automations</span>
          <span className="text-[var(--muted-foreground)]">{paused} paused</span>
          <span className={blocked ? "text-amber-300" : "text-[var(--muted-foreground)]"}>{blocked} need attention</span>
          <span className="ml-auto inline-flex items-center gap-2 text-xs text-[var(--muted-foreground)]"><Clock3 className="h-3.5 w-3.5" />Checked {at(overview.checkedAt, Intl.DateTimeFormat().resolvedOptions().timeZone)}</span>
        </div>
        <section className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div><h2 className="font-semibold text-white">Auto-book new overnight streams</h2><p className="mt-1 max-w-2xl text-sm text-[var(--muted-foreground)]">{overview.autoScheduleOvernight ? "New overnight ingests may book finished outputs into future video and Threads slots." : "New overnight ingests stop at ready to schedule."} Existing standing instructions stay with their streams. Pause Stream Pipeline to stop their automatic booking.</p></div>
          <Button variant="secondary" disabled={busy !== null || refreshing || Boolean(error)} onClick={() => void change("overnight", { action: "overnight-scheduling", enabled: !overview.autoScheduleOvernight })}>{busy === "overnight" ? "Saving..." : overview.autoScheduleOvernight ? "Turn off" : "Enable overnight scheduling"}</Button>
        </section>
        <p className="mb-5 text-xs text-[var(--muted-foreground)]">Resume allows the existing configured schedule to continue. Missing tasks, disconnected accounts and switched-off publishing still block work. A current action may finish before the next pause check.</p>
        <div className="grid gap-5 lg:grid-cols-2">{overview.cards.map((card) => <AutomationPanel key={card.id} card={card} stale={Boolean(error)} busy={busy !== null || refreshing} onPause={(selected) => void change(selected.id, { action: "pause", id: selected.id, paused: !selected.paused })} />)}</div>
      </>}
    </div>
  );
}
