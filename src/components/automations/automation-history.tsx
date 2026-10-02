"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, History, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AUTOMATION_IDS, type AutomationEventKind, type AutomationHistory, type AutomationId } from "@/lib/automations/types";
import { cn } from "@/lib/utils";

const names: Record<AutomationId, string> = { pipeline: "Stream pipeline", ingest: "Channel ingest", publisher: "Publisher", threads: "Threads", podcast: "Podcast / Spotify" };
const labels: Record<AutomationEventKind, string> = { completed: "Check completed", failed: "Failed", retrying: "Retry scheduled", delivered: "Delivered", scheduled: "Accepted / scheduled", blocked: "Blocked", paused: "Paused", resumed: "Resumed" };

function at(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

export function AutomationHistoryPanel() {
  const [automationId, setAutomationId] = useState("all");
  const [kind, setKind] = useState("activity");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{ key: string; data: AutomationHistory } | null>(null);
  const [failure, setFailure] = useState<{ key: string; detail: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const key = `${automationId}:${kind}:${page}`;
  const data = snapshot?.key === key ? snapshot.data : null;
  const error = failure?.key === key ? failure.detail : null;

  useEffect(() => {
    let active = true;
    let pending = false;
    let controller: AbortController | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      if (pending) return;
      pending = true;
      controller = new AbortController();
      deadline = setTimeout(() => controller?.abort(), 10_000);
      setRefreshing(true);
      const query = new URLSearchParams({ page: String(page) });
      if (automationId !== "all") query.set("automationId", automationId);
      if (kind !== "all") query.set("kind", kind);
      try {
        const response = await fetch(`/api/automations/history?${query}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "History could not be loaded.");
        if (active) { setSnapshot({ key, data: payload }); setFailure(null); }
      } catch (error) {
        if (active) setFailure({ key, detail: error instanceof Error ? error.message : "History could not be loaded." });
      } finally {
        clearTimeout(deadline);
        pending = false;
        if (active) setRefreshing(false);
      }
    }
    const first = setTimeout(() => { void load(); }, 0);
    const interval = setInterval(() => { if (!document.hidden) void load(); }, 20_000);
    return () => { active = false; clearTimeout(first); clearTimeout(deadline); clearInterval(interval); controller?.abort(); };
  }, [automationId, kind, page, key, revision]);

  return (
    <section className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5" aria-labelledby="automation-history-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="automation-history-title" className="flex items-center gap-2 text-lg font-semibold text-white"><History className="h-5 w-5 text-[var(--accent)]" />Last seven days</h2><p className="mt-1 text-sm text-[var(--muted-foreground)]">Failures, retries and confirmed deliveries stay here after queues change or the app restarts.</p></div>
        <Button variant="secondary" disabled={refreshing} onClick={() => setRevision((value) => value + 1)} aria-label="Refresh automation history"><RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />Refresh history</Button>
      </div>
      <div className="mt-5 flex flex-wrap gap-4">
        <label className="text-xs text-[var(--muted-foreground)]">Automation<select value={automationId} onChange={(event) => { setAutomationId(event.target.value); setPage(1); }} className="mt-1 block min-w-44 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-white"><option value="all">All automations</option>{AUTOMATION_IDS.map((id) => <option key={id} value={id}>{names[id]}</option>)}</select></label>
        <label className="text-xs text-[var(--muted-foreground)]">Outcome<select value={kind} onChange={(event) => { setKind(event.target.value); setPage(1); }} className="mt-1 block min-w-44 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-white"><option value="activity">Deliveries and issues</option><option value="all">All events, including checks</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      {error && <p role="alert" className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">{error} {data ? "The last snapshot is shown; counts are not current." : "Delivery counts are unavailable."}</p>}
      {!data && !error && <p className="mt-5 flex items-center gap-2 text-sm text-[var(--muted-foreground)]"><Loader2 className="h-4 w-4 animate-spin" />Loading history...</p>}
      {data && <>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[{ label: "Successful deliveries", value: data.counts.delivered }, { label: "Retries scheduled", value: data.counts.retrying }, { label: "Delivery failures", value: data.counts.failed }, { label: "Worker issues", value: data.counts.workerIssues }].map(({ label, value }) => <div key={label} className="rounded-xl bg-white/5 p-3"><p className="text-2xl font-semibold tabular-nums text-white">{value}</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">{label}</p></div>)}
        </div>
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">Counts cover {automationId === "all" ? "all automations" : names[automationId as AutomationId]} from {at(data.from)} to {at(data.to)} in your local timezone. Repeated checks and scheduling handoffs do not count as successful deliveries. Podcast delivery means RSS publication; Spotify pickup is not confirmed.</p>
        {data.warnings.map((warning) => <p key={warning} role="status" className="mt-3 rounded-lg bg-amber-500/5 p-3 text-sm text-amber-200">{warning}</p>)}
        {!data.total ? <p className="mt-5 rounded-xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--muted-foreground)]">No matching events recorded in the last seven days. New worker activity appears automatically; earlier activity is not reconstructed.</p> : <ol className="mt-5 divide-y divide-[var(--border)]">
          {data.events.map((event) => <li key={event.id} className="py-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className={cn("rounded-full px-2 py-1 text-xs font-medium", event.kind === "failed" || event.kind === "blocked" ? "bg-amber-500/10 text-amber-300" : event.kind === "delivered" ? "bg-emerald-500/10 text-emerald-300" : "bg-white/10 text-[var(--muted-foreground)]")}>{event.kind === "delivered" && event.destination === "RSS feed" ? "In feed" : labels[event.kind]}</span><span className="text-sm font-medium text-white">{names[event.automationId]}</span>{event.destination && <span className="text-xs text-[var(--muted-foreground)]">{event.destination}</span>}<time dateTime={event.at} className="ml-auto text-xs tabular-nums text-[var(--muted-foreground)]">{at(event.at)}</time></div>
            <p className="mt-2 break-words text-sm text-[var(--muted-foreground)]">{event.detail}</p>
            {event.nextAttemptAt && <p className="mt-1 text-xs text-amber-200">Next attempt {at(event.nextAttemptAt)}</p>}
          </li>)}
        </ol>}
        <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-4"><p className="text-xs text-[var(--muted-foreground)]">{data.total} matching events · Page {data.page} of {data.pages}</p><div className="flex gap-2"><Button variant="secondary" disabled={refreshing || Boolean(error) || data.page <= 1} onClick={() => setPage(data.page - 1)} aria-label="Previous history page"><ChevronLeft className="h-4 w-4" /></Button><Button variant="secondary" disabled={refreshing || Boolean(error) || data.page >= data.pages} onClick={() => setPage(data.page + 1)} aria-label="Next history page"><ChevronRight className="h-4 w-4" /></Button></div></div>
      </>}
    </section>
  );
}
