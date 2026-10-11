"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowUpRight, Check, Clock3, Copy, ExternalLink, Loader2, Moon, Pause, Play, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { AutomationHistoryPanel } from "@/components/automations/automation-history";
import { OvernightConfirmDialog } from "@/components/automations/overnight-confirm";
import { THREADS_POSTS_RAISE_NOTE } from "@/lib/automations/cadence";
import { MAX_SHORTS_PER_DAY, MAX_SLOT_TIMES, MAX_THREADS_POSTS_PER_DAY, MIN_SHORTS_PER_DAY, MIN_THREADS_POSTS_PER_DAY, checkCadenceInput, type CadenceInput, type CadenceValues } from "@/lib/automations/cadenceInput";
import { overnightConsequence } from "@/lib/automations/overnight";
import { describeTaskResult } from "@/lib/automations/format";
import { orderWarnings } from "@/lib/automations/warnings";
import { useColateralSurface } from "@/lib/colateral/useSurface";
import type { AutomationCard, AutomationId, AutomationOverview, CadenceRow, HeldPost } from "@/lib/automations/types";
import { cn } from "@/lib/utils";

const stateLabels = {
  paused: "Paused", blocked: "Blocked", running: "Running", ready: "Idle - waiting for next run", attention: "Needs attention", unknown: "Has not run yet"
};

/** The automations that put things on the public internet; "Pause all posting" covers exactly these. */
const POSTING_IDS: AutomationId[] = ["publisher", "threads", "podcast"];

/** Run from an Administrator PowerShell once; the advice is the register script's own. */
const KEEP_AWAKE = ["powercfg /change standby-timeout-ac 0", "powercfg /change standby-timeout-dc 0", "powercfg /change hibernate-timeout-ac 0", "powercfg /change hibernate-timeout-dc 0"];

function at(value: string | null, timezone: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not yet";
  return new Intl.DateTimeFormat(undefined, { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function CopyCommand({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2 rounded-lg bg-black/30 py-1 pl-3 pr-1 font-mono text-xs text-white">
      {text}
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-sans text-[11px] text-[var(--accent)] hover:bg-white/10"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => toast.error("Clipboard unavailable - select and copy the command."));
        }}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

function KeepAwake() {
  return (
    <details className="mt-4 rounded-xl border border-[var(--border)] p-3 text-xs text-[var(--muted-foreground)]">
      <summary className="flex cursor-pointer items-center gap-2 font-medium text-white"><Moon className="h-3.5 w-3.5 text-[var(--accent)]" />Keep this PC awake</summary>
      <p className="mt-2">A sleeping PC posts nothing, and the failure is silent: the night&apos;s slots are simply missed. The background runner cannot wake the machine itself. To keep it awake (the screen can still turn off), run these once in PowerShell:</p>
      <ul className="mt-2 space-y-1">{KEEP_AWAKE.map((command) => <li key={command}><CopyCommand text={command} /></li>)}</ul>
      <p className="mt-2">The runner also only works while you are signed in to Windows, unless it was installed from an Administrator PowerShell.</p>
    </details>
  );
}

/** Two warnings are a glance; a wall of them is noise, so the rest sit behind a disclosure. */
const VISIBLE_WARNINGS = 2;

function Warning({ text }: { text: string }) {
  return <p className="flex gap-2"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0 break-words">{text}</span></p>;
}

function WarningList({ warnings }: { warnings: string[] }) {
  const ordered = orderWarnings(warnings);
  const shown = ordered.slice(0, VISIBLE_WARNINGS);
  const rest = ordered.slice(VISIBLE_WARNINGS);
  return (
    <div className="mt-4 space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">
      {shown.map((warning, index) => <Warning key={`${index}-${warning}`} text={warning} />)}
      {rest.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-amber-300 hover:text-amber-100">
            <span className="group-open:hidden">Show {rest.length} more {rest.length === 1 ? "warning" : "warnings"}</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <div className="mt-2 space-y-2">
            {rest.map((warning, index) => <Warning key={`${index}-${warning}`} text={warning} />)}
          </div>
        </details>
      )}
    </div>
  );
}

function AutomationPanel({ card, busy, stale, onPause }: {
  card: AutomationCard; busy: boolean; stale: boolean; onPause: (card: AutomationCard) => void;
}) {
  const needsAttention = card.state === "blocked" || card.state === "attention";
  const missingTask = Boolean(card.registerCommand) && card.blockers.some((blocker) => blocker.includes(" not installed - "));
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
        <div><dt className="text-xs text-[var(--muted-foreground)]">Next run</dt><dd className="mt-1 text-white">{card.paused ? "Paused" : at(card.nextRunAt, card.timezone)}</dd></div>
        <div><dt className="text-xs text-[var(--muted-foreground)]">Next queued item</dt><dd className="mt-1 text-white">{at(card.nextItemAt, card.timezone)}</dd></div>
        <div><dt className="text-xs text-[var(--muted-foreground)]">Last ran</dt><dd className="mt-1 text-white">{at(card.lastRunAt, card.timezone)}</dd></div>
        <div><dt className="text-xs text-[var(--muted-foreground)]">Last outcome</dt><dd className="mt-1 text-white">{card.lastOutcome ?? "Nothing recorded yet"}</dd></div>
      </dl>
      {card.taskLastRunAt && <p className="mt-3 text-xs text-[var(--muted-foreground)]">The background runner last started {at(card.taskLastRunAt, card.timezone)} and <span title={`Windows result code: ${card.taskLastResult ?? "none"}`} className="underline decoration-dotted underline-offset-2">{describeTaskResult(card.taskLastResult)}</span>. That does not confirm a post went out; the history below does.</p>}
      {(card.blockers.length > 0 || card.issues.length > 0) && (
        <WarningList warnings={[...card.blockers, ...card.issues]} />
      )}
      {missingTask && card.registerCommand && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]"><span>To install it, run in the app folder:</span><CopyCommand text={card.registerCommand} /></div>}
      {(card.id === "publisher" || card.id === "threads") && <KeepAwake />}
      {card.id === "pipeline" && <p className="mt-4 text-xs text-[var(--muted-foreground)]">Pause stops all stream processing: advancing outputs and fulfilling standing schedules, not only auto-booking.</p>}
      {card.id === "publisher" && <p className="mt-4 text-xs text-[var(--muted-foreground)]">Pause stops anything new from being sent. Posts already scheduled with a platform or Buffer can still go live; manage those posts on the platform. Explicit per-post Publish now remains available.</p>}
      {card.id === "podcast" && <p className="mt-4 text-xs text-[var(--muted-foreground)]">An episode in the feed has been handed off. Spotify decides when it becomes live; check its delivery on Podcast / Spotify.</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-[var(--muted-foreground)]">{card.changedAt ? `Control saved ${at(card.changedAt, card.timezone)}` : "No pause override saved"}</span>
        <Link href={card.itemHref ?? card.href} className="inline-flex items-center gap-1 font-medium text-[var(--accent)]">Manage details <ArrowUpRight className="h-3.5 w-3.5" /></Link>
      </div>
    </section>
  );
}

function HeldPanel({ held, total, timezone }: { held: HeldPost[]; total: number; timezone: string }) {
  return (
    <section className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-labelledby="held-title">
      <h2 id="held-title" className="font-semibold text-white">Still going live - cancel these on the platform</h2>
      <p className="mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]">YouTube, Facebook and Buffer already hold these and publish them at their time by themselves. Pausing here cannot stop them; cancel or edit them on the platform.</p>
      {!held.length ? <p className="mt-3 text-sm text-[var(--muted-foreground)]">Nothing is waiting on a platform. Once the publisher is paused, nothing else will go live from the queue.</p> : <>
        <ul className="mt-3 divide-y divide-[var(--border)]">
          {held.map((post) => (
            <li key={post.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white">{post.platform}</span>
              <Link href={post.href} className="min-w-0 flex-1 truncate text-white hover:text-[var(--accent)]">{post.title}</Link>
              <time dateTime={post.goesLiveAt} className="text-xs tabular-nums text-[var(--muted-foreground)]">Goes live {at(post.goesLiveAt, timezone)}</time>
              {post.externalUrl && <a href={post.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)]">{post.externalLabel ?? "Open"}<ExternalLink className="h-3 w-3" /></a>}
            </li>
          ))}
        </ul>
        {total > held.length && <p className="mt-2 text-xs text-[var(--muted-foreground)]">Showing the next {held.length} of {total}.</p>}
      </>}
    </section>
  );
}

type CadenceDraft = { shortsPerDay: number; threadsPostsPerDay: number | null; slotTimes: string[]; weekendSlotTimes: string[] };

/** A time not already in the list, so "Add time" never makes a duplicate the server would fold away. */
function nextFreeTime(taken: string[]): string {
  for (const candidate of ["09:00", "12:00", "15:00", "18:00", "21:00", "07:00", "10:30", "13:30"]) if (!taken.includes(candidate)) return candidate;
  return "";
}

function TimeListEditor({ label, times, onChange, disabled }: { label: string; times: string[]; onChange: (next: string[]) => void; disabled: boolean }) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-xs text-[var(--muted-foreground)]">{label}</legend>
      <ul className="mt-1 flex flex-wrap items-center gap-2">
        {times.map((time, index) => (
          <li key={index} className="inline-flex items-center gap-1">
            <input
              type="time"
              aria-label={`${label} ${index + 1}`}
              value={time}
              disabled={disabled}
              onChange={(event) => onChange(times.map((current, at) => (at === index ? event.target.value : current)))}
              className="rounded-md border border-[var(--border)] bg-black/30 px-2 py-1 text-sm text-white"
            />
            <button type="button" aria-label={`Remove ${label} ${index + 1}`} disabled={disabled || times.length <= 1} onClick={() => onChange(times.filter((_, at) => at !== index))} className="rounded-md px-1.5 py-1 text-xs text-[var(--muted-foreground)] hover:bg-white/10 disabled:opacity-40">Remove</button>
          </li>
        ))}
        <li><button type="button" disabled={disabled || times.length >= MAX_SLOT_TIMES} onClick={() => onChange([...times, nextFreeTime(times)])} className="rounded-md px-2 py-1 text-xs font-medium text-[var(--accent)] hover:bg-white/10 disabled:opacity-40">Add time</button></li>
      </ul>
    </fieldset>
  );
}

function CadencePanel({ rows, values, disabled, onSaved }: { rows: CadenceRow[]; values: CadenceValues; disabled: boolean; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<CadenceDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const editing = draft !== null;

  async function save() {
    if (!draft) return;
    const check = checkCadenceInput(draft);
    if (!check.ok) { setProblem(check.problem); return; }
    // Only what changed is sent, so saving the slot times never pins an untouched setting into .env.
    const changed: CadenceInput = {};
    if (check.value.shortsPerDay !== undefined && check.value.shortsPerDay !== values.shortsPerDay) changed.shortsPerDay = check.value.shortsPerDay;
    if (check.value.threadsPostsPerDay !== undefined && check.value.threadsPostsPerDay !== values.threadsPostsPerDay) changed.threadsPostsPerDay = check.value.threadsPostsPerDay;
    if (check.value.slotTimes && check.value.slotTimes.join() !== values.slotTimes.join()) changed.slotTimes = check.value.slotTimes;
    if (check.value.weekendSlotTimes && check.value.weekendSlotTimes.join() !== values.weekendSlotTimes.join()) changed.weekendSlotTimes = check.value.weekendSlotTimes;
    if (Object.keys(changed).length === 0) { toast.message("Nothing was changed."); setDraft(null); return; }
    setSaving(true);
    setProblem(null);
    try {
      const response = await fetch("/api/automations/cadence", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changed) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "The cadence could not be saved.");
      toast.success(changed.threadsPostsPerDay !== undefined ? "Cadence saved. Threads posts per day applies from the next batch." : "Cadence saved. New bookings use it now.");
      setDraft(null);
      await onSaved();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "The cadence could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="cadence" className="mt-5 scroll-mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-labelledby="cadence-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="cadence-title" className="font-semibold text-white">Cadence</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]">When and how often things post. Shorts per day, Threads posts per day and the posting times can be changed here. Shorts and slot changes apply to new bookings; already-booked posts keep their times.</p>
        </div>
        {!editing && <Button variant="secondary" disabled={disabled} onClick={() => { setProblem(null); setDraft({ shortsPerDay: values.shortsPerDay, threadsPostsPerDay: values.threadsPostsPerDay, slotTimes: [...values.slotTimes], weekendSlotTimes: [...values.weekendSlotTimes] }); }}>Edit</Button>}
        {editing && <div className="flex gap-2">
          <Button variant="secondary" disabled={saving} onClick={() => { setDraft(null); setProblem(null); }}>Cancel</Button>
          <Button disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : "Save"}</Button>
        </div>}
      </div>
      {problem && <p role="alert" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">{problem}</p>}
      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.env}>
            {editing && draft && row.editable ? (
              <>
                {row.env === "PUBLISH_SHORTS_PER_DAY" ? (
                  <>
                    <dt className="text-xs text-[var(--muted-foreground)]"><label htmlFor="cadence-shorts">{row.label}</label></dt>
                    <dd className="mt-0.5">
                      <select id="cadence-shorts" value={draft.shortsPerDay} disabled={saving} onChange={(event) => setDraft({ ...draft, shortsPerDay: Number(event.target.value) })} className="rounded-md border border-[var(--border)] bg-black/30 px-2 py-1 text-sm text-white">
                        {Array.from({ length: MAX_SHORTS_PER_DAY - MIN_SHORTS_PER_DAY + 1 }, (_, index) => MIN_SHORTS_PER_DAY + index).map((count) => <option key={count} value={count}>{count}</option>)}
                      </select>
                    </dd>
                  </>
                ) : row.env === "THREADS_POSTS_PER_DAY" ? (
                  <>
                    <dt className="text-xs text-[var(--muted-foreground)]"><label htmlFor="cadence-threads">{row.label}</label></dt>
                    <dd className="mt-0.5">
                      <input
                        id="cadence-threads"
                        type="number"
                        inputMode="numeric"
                        min={MIN_THREADS_POSTS_PER_DAY}
                        max={MAX_THREADS_POSTS_PER_DAY}
                        step={1}
                        value={draft.threadsPostsPerDay ?? ""}
                        disabled={saving}
                        onChange={(event) => setDraft({ ...draft, threadsPostsPerDay: event.target.value === "" ? null : Number(event.target.value) })}
                        className="w-24 rounded-md border border-[var(--border)] bg-black/30 px-2 py-1 text-sm text-white"
                      />
                      <span className="ml-2 text-xs text-[var(--muted-foreground)]">{MIN_THREADS_POSTS_PER_DAY} to {MAX_THREADS_POSTS_PER_DAY}, per account</span>
                    </dd>
                    {draft.threadsPostsPerDay !== null && draft.threadsPostsPerDay > values.threadsPostsPerDay && <dd className="mt-1 text-xs text-amber-200">{THREADS_POSTS_RAISE_NOTE}</dd>}
                  </>
                ) : (
                  <dd>
                    <TimeListEditor label={row.label} times={row.env === "PUBLISH_SLOT_TIMES" ? draft.slotTimes : draft.weekendSlotTimes} disabled={saving} onChange={(next) => setDraft(row.env === "PUBLISH_SLOT_TIMES" ? { ...draft, slotTimes: next } : { ...draft, weekendSlotTimes: next })} />
                  </dd>
                )}
                {row.note && <dd className="text-xs text-[var(--muted-foreground)]">{row.note}</dd>}
              </>
            ) : (
              <>
                <dt className="text-xs text-[var(--muted-foreground)]">{row.label}</dt>
                <dd className="mt-0.5 text-sm text-white">{row.value}</dd>
                {row.note && <dd className="text-xs text-[var(--muted-foreground)]">{row.note}</dd>}
              </>
            )}
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-[var(--muted-foreground)]">Read-only here: time zone, booking reach and the Threads window, time zone and late grace, because they reshape batches already laid out.</p>
      <details className="mt-2 text-xs text-[var(--muted-foreground)]">
        <summary className="cursor-pointer font-medium hover:text-white">Advanced: set in .env</summary>
        <p className="mt-2">Edit these in the <code className="rounded bg-black/30 px-1">.env</code> file, then restart the app.</p>
        <ul className="mt-2 space-y-1">{rows.map((row) => <li key={row.env}>{row.label}: <code className="rounded bg-black/30 px-1.5 py-0.5 text-[10px]">{row.env}</code></li>)}</ul>
      </details>
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
  const [confirmOvernight, setConfirmOvernight] = useState(false);
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

  async function patch(body: object): Promise<Record<string, unknown> & { id?: string; control?: { paused: boolean; changedAt: string | null } }> {
    const response = await fetch("/api/automations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Automation controls could not be saved.");
    return payload;
  }

  async function change(id: string, body: object) {
    if (changing.current || inflight.current) return;
    changing.current = true;
    setBusy(id);
    try {
      const payload = await patch(body);
      if ("control" in payload && payload.control) {
        const control = payload.control;
        setOverview((current) => current ? { ...current, cards: current.cards.map((card) => card.id === payload.id ? { ...card, ...control, state: control.paused ? "paused" : "unknown" } : card) } : current);
      } else {
        setOverview((current) => current ? { ...current, autoScheduleOvernight: payload.autoScheduleOvernight as boolean } : current);
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

  /** A poll already in flight started before the save, so wait it out and read again. */
  async function reloadAfterSave() {
    for (let waited = 0; inflight.current && waited < 100; waited += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    await load();
  }

  /** Pause or resume the three automations that post publicly, one existing PATCH each. */
  async function setAllPosting(paused: boolean) {
    if (changing.current || inflight.current || !overview) return;
    const targets = overview.cards.filter((card) => POSTING_IDS.includes(card.id) && card.paused !== paused);
    if (!targets.length) return;
    changing.current = true;
    setBusy("all");
    const failed: string[] = [];
    for (const card of targets) {
      try { await patch({ action: "pause", id: card.id, paused }); } catch { failed.push(card.title); }
    }
    if (failed.length) toast.error(`${paused ? "Pause" : "Resume"} did not save for: ${failed.join(", ")}.`);
    else toast.success(paused ? "Publisher, Threads and podcast are paused." : "Publisher, Threads and podcast are resumed.");
    changing.current = false;
    try { await load(); } finally { setBusy(null); }
  }

  // /automations#cadence: the card only exists once the overview has loaded, so the browser's own
  // anchor jump finds nothing. Scroll once, the first time it is there.
  const scrolledToHash = useRef(false);
  const loaded = overview !== null;
  useEffect(() => {
    if (!loaded || scrolledToHash.current) return;
    scrolledToHash.current = true;
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [loaded]);

  const blocked = overview?.cards.filter((card) => card.state === "blocked" || card.state === "attention").length ?? 0;
  const paused = overview?.cards.filter((card) => card.paused).length ?? 0;
  const posting = overview?.cards.filter((card) => POSTING_IDS.includes(card.id)) ?? [];
  // One zone for every stamp on the page: the publisher's, never the browser's (which is only the fallback).
  const publishZone = overview?.cards.find((card) => card.id === "publisher")?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const anyPostingRunning = posting.some((card) => !card.paused);
  const anyPostingPaused = posting.some((card) => card.paused);

  useColateralSurface({
    route: "/automations",
    title: "Automations",
    summary: "Background jobs that publish for you: which are paused, what failed or posted today, and what the platforms still hold.",
    fields: [],
    controls: [],
    readings: [
      { label: "Paused automations", value: overview ? (overview.cards.filter((card) => card.paused).map((card) => card.title).join(", ") || "None") : "-" },
      { label: "Failed today", value: overview ? String(overview.today.failed) : "-" },
      { label: "Posted today", value: overview ? String(overview.today.delivered) : "-" },
      { label: "Need attention", value: overview ? String(blocked) : "-" },
      { label: "Held by platforms", value: overview ? String(overview.heldTotal) : "-" }
    ]
  });

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <PageHeader eyebrow="CoLateral Marketing" title="Automations" description="See what runs in the background, when it runs, what happened last and what needs fixing. Pause switches are saved, and each background job checks them before it acts." actions={<Button variant="secondary" onClick={() => void load()} disabled={refreshing || busy !== null}><RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />Refresh</Button>} />
      {error && <div role="alert" className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">Status is unavailable: {error} {overview ? "The last snapshot is shown below; controls are disabled until status returns." : "Nothing is assumed about what is running."}</div>}
      {!overview && !error && <p className="flex items-center gap-2 py-10 text-sm text-[var(--muted-foreground)]"><Loader2 className="h-4 w-4 animate-spin" />Loading saved switches and recent activity...</p>}
      {overview && <>
        <div className="mb-5 flex flex-wrap gap-5 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
          <span className="inline-flex items-center gap-2 text-white"><Activity className="h-4 w-4 text-[var(--accent)]" />{overview.cards.length} automations</span>
          <span className="text-[var(--muted-foreground)]">{paused} paused</span>
          <span className={blocked ? "text-amber-300" : "text-[var(--muted-foreground)]"}>{blocked} need attention</span>
          <span className="ml-auto inline-flex items-center gap-2 text-xs text-[var(--muted-foreground)]"><Clock3 className="h-3.5 w-3.5" />Checked {at(overview.checkedAt, publishZone)}</span>
        </div>
        <section className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div><h2 className="font-semibold text-white">Pause all posting</h2><p className="mt-1 max-w-2xl text-sm text-[var(--muted-foreground)]">Pauses the publisher, the Threads autopilot and the podcast in one go. Stream Pipeline and Channel ingest keep running. Posts a platform already holds still go live (listed below).</p></div>
          <div className="flex flex-wrap gap-2">
            {anyPostingRunning && <Button variant="secondary" disabled={busy !== null || refreshing || Boolean(error)} onClick={() => void setAllPosting(true)}>{busy === "all" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pause className="mr-2 h-4 w-4" />}Pause all posting</Button>}
            {anyPostingPaused && <Button variant="secondary" disabled={busy !== null || refreshing || Boolean(error)} onClick={() => void setAllPosting(false)}>{busy === "all" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Resume all</Button>}
          </div>
        </section>
        <HeldPanel held={overview.held} total={overview.heldTotal} timezone={publishZone} />
        <section className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div><h2 className="font-semibold text-white">Auto-book overnight streams</h2><p className={cn("mt-1 max-w-2xl text-sm", overview.autoScheduleOvernight ? "text-amber-200" : "text-[var(--muted-foreground)]")}>{overnightConsequence(overview.autoScheduleOvernight)}</p><p className="mt-1 max-w-2xl text-sm text-[var(--muted-foreground)]">Existing standing instructions stay with their streams. Pausing Stream Pipeline below stops all stream processing, not only this booking.</p></div>
          <Button variant="secondary" disabled={busy !== null || refreshing || Boolean(error)} onClick={() => { if (overview.autoScheduleOvernight) void change("overnight", { action: "overnight-scheduling", enabled: false }); else setConfirmOvernight(true); }}>{busy === "overnight" ? "Saving..." : overview.autoScheduleOvernight ? "Turn off" : "Turn on"}</Button>
        </section>
        <OvernightConfirmDialog open={confirmOvernight} busy={busy !== null} onCancel={() => setConfirmOvernight(false)} onConfirm={() => { setConfirmOvernight(false); void change("overnight", { action: "overnight-scheduling", enabled: true }); }} />
        <p className="mb-5 text-xs text-[var(--muted-foreground)]">Resume allows the existing configured schedule to continue. Missing tasks, disconnected accounts and switched-off publishing still block work. A current action may finish before the next pause check.</p>
        <div className="grid gap-5 lg:grid-cols-2">{overview.cards.map((card) => <AutomationPanel key={card.id} card={card} stale={Boolean(error)} busy={busy !== null || refreshing} onPause={(selected) => void change(selected.id, { action: "pause", id: selected.id, paused: !selected.paused })} />)}</div>
        <CadencePanel rows={overview.cadence} values={overview.cadenceValues} disabled={busy !== null || refreshing || Boolean(error)} onSaved={reloadAfterSave} />
      </>}
      <AutomationHistoryPanel timezone={publishZone} />
    </div>
  );
}
