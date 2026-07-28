"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  BookOpen,
  CalendarClock,
  Check,
  Clock,
  Copy,
  Download,
  MessageSquare,
  MessagesSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { toast } from "sonner";
import { useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { localDateKey } from "@/lib/x-strategy/analytics";
import { exportBaseName, toThreadsCsv, toThreadsJson } from "@/lib/x-posts/export";
import { cn } from "@/lib/utils";
import type { ThreadsBatchSummary } from "@/lib/threads/types";
import type { XDailyPack, XPostFormat, XSuggestedPost, XSuggestedReply } from "@/types/domain";

interface GenerateResponse {
  pack: XDailyPack;
  cached: boolean;
  reason: string | null;
  configured: boolean;
}

interface AutopilotStatus {
  enabled: boolean;
  configured: boolean;
  blockedReason: string | null;
  settings: {
    timezone: string;
    postsPerDay: number;
    lateGraceMinutes: number;
    accounts: Array<{ id: string; label: string; posts: "text" | "variant"; offsetMinutes: number }>;
    unassignedVersions: Array<"text" | "variant">;
  };
  scheduler?: { lastTickAt?: string; lastPostAt?: string; healthy: boolean; minutesSince: number | null };
  today: ThreadsBatchSummary;
  items: unknown[];
}

interface AutopilotActionResponse {
  error?: string;
  checks?: Array<{ accountId: string; label: string; ok: boolean; username?: string | null; error?: string }>;
  plan?: { created: number; skipped?: string };
  run?: { published: number; skipped: number; note?: string };
  moved?: number;
}

const FORMAT_STYLES: Record<XPostFormat, string> = {
  insight: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  contrarian: "border-rose-400/30 bg-rose-400/10 text-rose-200",
  story: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  question: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  framework: "border-violet-400/30 bg-violet-400/10 text-violet-200",
  observation: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"
};

function formatTime(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const meridiem = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

/** Absolute local stamp, e.g. "Jul 22, 2:34 PM", for showing when a pack was written. */
function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Human "how long ago" against a live `now`, so the batch's freshness is obvious at a glance. */
function relativeFrom(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Wall-clock seconds between clicking Generate and the pack finishing, when both stamps exist. */
function durationSeconds(requestedAt: string | undefined, createdAt: string): number | null {
  if (!requestedAt) return null;
  const ms = new Date(createdAt).getTime() - new Date(requestedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 100) / 10;
}

function triggerDownload(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function useCopy() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copy = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
    } catch {
      toast.error("Clipboard unavailable — select and copy the text manually.");
    }
  }, []);
  return { copiedId, copy };
}

export function XPostsPage() {
  const { data, loading, refresh } = useAppData();
  const today = localDateKey();

  const storedPack = useMemo(
    () => data.xPlanner?.packs.find((pack) => pack.date === today) ?? null,
    [data.xPlanner, today]
  );

  const [pack, setPack] = useState<XDailyPack | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [focus, setFocus] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const autoRequested = useRef(false);

  const activePack = pack ?? storedPack;
  const autopilot = useAutopilot();

  // Keep the "generated Xm ago" freshness read-out live so a stale, cached pack
  // is visibly old — the whole point is not to copy something from before.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const generate = useCallback(
    async (force: boolean) => {
      setGenerating(true);
      try {
        const response = await fetch("/api/x-posts/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ focus, force, requestedAt: new Date().toISOString() })
        });
        if (!response.ok) throw new Error("request failed");
        const json = (await response.json()) as GenerateResponse;
        setPack(json.pack);
        setReason(json.reason);
        if (!json.cached) {
          toast.success(force ? "Fresh pack generated." : "Today's pack is ready.");
          void refresh();
        }
      } catch {
        toast.error("Could not generate today's pack.");
      } finally {
        setGenerating(false);
      }
    },
    [focus, refresh]
  );

  // First visit of the day: kick off generation automatically so the pack is
  // simply there, matching the "every day it suggests" behaviour.
  useEffect(() => {
    if (loading || storedPack || autoRequested.current) return;
    autoRequested.current = true;
    void generate(false);
  }, [loading, storedPack, generate]);

  return (
    <div>
      <PageHeader
        eyebrow="Step 2 · Formats"
        title="Post Engine"
        description="Hit Generate for 24 fresh original posts — each with a reworded Threads variant — plus twenty ready replies for engaging as you scroll. Every press writes a brand-new set matched to your positioning brief, avoiding angles from your recent packs. Suggestions only, nothing is tracked."
        actions={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              placeholder="Optional focus (e.g. context engineering)"
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              className="sm:w-64"
            />
            <Button onClick={() => generate(true)} disabled={generating} className="shrink-0">
              <RefreshCw className={cn("mr-2 h-4 w-4", generating && "animate-spin")} />
              {generating ? "Writing…" : activePack ? "Generate 24 fresh" : "Generate 24 posts"}
            </Button>
          </div>
        }
      />

      {reason ? (
        <div className="mb-6 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">{reason}</div>
      ) : null}

      {activePack ? <PackSummary pack={activePack} now={now} /> : null}

      <div className="mt-6">
        <AutopilotCard {...autopilot} />
      </div>

      <div className="mt-6">
        {activePack ? (
          <Tabs
            tabs={[
              {
                id: "schedule",
                label: "Today's posts",
                icon: Clock,
                content: <ScheduleTab posts={activePack.posts} />
              },
              {
                id: "autopilot",
                label: "Autopilot schedule",
                icon: CalendarClock,
                content: <AutopilotTab {...autopilot} />
              },
              {
                id: "export",
                label: "Schedule / export",
                icon: CalendarClock,
                content: <ExportTab pack={activePack} now={now} />
              },
              {
                id: "replies",
                label: "Reply bank",
                icon: MessagesSquare,
                content: <RepliesTab replies={activePack.replies} />
              },
              {
                id: "playbook",
                label: "Playbook",
                icon: BookOpen,
                content: <PlaybookTab />
              }
            ]}
          />
        ) : (
          <Card>
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Sparkles className="h-8 w-8 text-[var(--accent)]" />
              <p className="text-sm text-[var(--muted-foreground)]">
                {generating || loading
                  ? "Writing 24 fresh posts and twenty replies…"
                  : "No pack yet — hit Generate for 24 fresh posts."}
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/**
 * The Threads autopilot: what the unattended loop has scheduled and sent
 * today. The scheduled task drives the same endpoints every few minutes — the
 * buttons here are for checking the setup or nudging it by hand.
 */
type QueueItemView = {
  id: string;
  batchDate: string;
  slot: number;
  accountId: string;
  version: "text" | "variant";
  topic: string;
  text: string;
  publishAt: string;
  status: "pending" | "published" | "failed" | "skipped";
  postId?: string;
  error?: string;
  note?: string;
};

/** "7:10 AM" in the viewer's own clock. */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** The value shape a datetime-local input wants: local wall clock, no zone. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function friendlyDate(dateKey: string): string {
  if (dateKey === localDateKey()) return "Today";
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

/** One loader shared by the summary card and the management board. */
function useAutopilot() {
  const [status, setStatus] = useState<AutopilotStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/threads");
      if (!response.ok) throw new Error("request failed");
      setStatus((await response.json()) as AutopilotStatus);
    } catch {
      setStatus(null);
    }
  }, []);

  const loadRequested = useRef(false);
  useEffect(() => {
    if (loadRequested.current) return;
    loadRequested.current = true;
    void load();
  }, [load]);

  // The scheduler keeps ticking while this page is open; without a refresh the
  // times and tallies on screen quietly go stale.
  useEffect(() => {
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const send = useCallback(
    async (body: Record<string, unknown>, key: string, success?: (json: AutopilotActionResponse) => string) => {
      setBusy(key);
      try {
        const response = await fetch("/api/threads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const json = (await response.json()) as AutopilotActionResponse;
        if (!response.ok) throw new Error(json.error ?? "request failed");
        if (success) toast.success(success(json));
        await load();
        return json;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "That didn't work.");
        return null;
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  return { status, busy, reload: load, send };
}

type AutopilotProps = ReturnType<typeof useAutopilot>;

function versionLabel(version: "text" | "variant"): string {
  return version === "text" ? "punchy version" : "warm rewrite";
}

function AutopilotCard({ status, busy, send }: AutopilotProps) {
  if (!status) return null;

  const { today, settings, blockedReason, scheduler } = status;
  const expected = settings.postsPerDay * Math.max(1, settings.accounts.length);
  const minutesSince = scheduler?.minutesSince;
  const heartbeat =
    minutesSince === null || minutesSince === undefined
      ? "never run"
      : minutesSince < 1
        ? "just now"
        : `${Math.round(minutesSince)} min ago`;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted-foreground)]">Threads autopilot</p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            {today.published}/{today.total || expected} posted today
          </h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {settings.postsPerDay} slots a day in {settings.timezone} ·{" "}
            {settings.accounts.map((account) => `${account.label} (${versionLabel(account.posts)})`).join(", ") ||
              "no account connected"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className={blockedReason ? "text-amber-200" : "text-[var(--accent)]"}>
            {blockedReason ? "Idle" : "Armed"}
          </Badge>
          {today.pending ? <Badge>{today.pending} queued</Badge> : null}
          {today.failed ? <Badge className="text-rose-200">{today.failed} failed</Badge> : null}
          {today.skipped ? <Badge>{today.skipped} skipped</Badge> : null}
          {today.nextAt ? <Badge className="text-[var(--accent)]">Next {clock(today.nextAt)}</Badge> : null}
        </div>
      </div>

      <div
        className={cn(
          "mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-3 py-2 text-xs",
          scheduler?.healthy
            ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
            : "border-amber-400/30 bg-amber-400/10 text-amber-100"
        )}
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Clock className="h-3.5 w-3.5" />
          Scheduler checked {heartbeat}
        </span>
        <span className="text-[var(--muted-foreground)]">
          {scheduler?.healthy
            ? "Ticking every 5 minutes."
            : "Expected every 5 minutes — the scheduled task may be off, or the PC asleep."}
        </span>
      </div>

      {blockedReason ? (
        <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          {blockedReason}
        </p>
      ) : null}

      {settings.unassignedVersions.length > 0 && !blockedReason ? (
        <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          No account posts the {settings.unassignedVersions.map(versionLabel).join(" or ")} — that half of each
          day&apos;s pack is written and never used.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={() =>
            send({ action: "plan" }, "plan", (json) => json.plan?.skipped ?? `Scheduled ${json.plan?.created ?? 0} posts.`)
          }
          disabled={busy !== null}
        >
          <CalendarClock className="mr-2 h-4 w-4" />
          {busy === "plan" ? "Scheduling…" : "Schedule today"}
        </Button>
        <Button
          onClick={() =>
            send({ action: "run-due" }, "run", (json) => json.run?.note ?? `Posted ${json.run?.published ?? 0}.`)
          }
          disabled={busy !== null}
        >
          <AtSign className="mr-2 h-4 w-4" />
          {busy === "run" ? "Posting…" : "Post what's due"}
        </Button>
        <Button
          onClick={() =>
            send(
              { action: "check" },
              "check",
              (json) =>
                `Connected: ${(json.checks ?? []).map((entry) => (entry.username ? `@${entry.username}` : entry.label)).join(", ")}.`
            )
          }
          disabled={busy !== null}
        >
          <ShieldCheck className="mr-2 h-4 w-4" />
          {busy === "check" ? "Checking…" : "Check connection"}
        </Button>
      </div>
    </Card>
  );
}

/** The batch board: what is going out, when, and every knob to change it. */
function AutopilotTab({ status, busy, send }: AutopilotProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const items = useMemo(() => (status?.items ?? []) as QueueItemView[], [status]);
  const dates = useMemo(() => [...new Set(items.map((item) => item.batchDate))].sort().reverse(), [items]);
  const active = selected && dates.includes(selected) ? selected : (dates[0] ?? localDateKey());
  const batch = useMemo(
    () => items.filter((item) => item.batchDate === active).sort((a, b) => a.publishAt.localeCompare(b.publishAt)),
    [items, active]
  );
  const pending = useMemo(() => batch.filter((item) => item.status === "pending"), [batch]);

  if (!status) {
    return (
      <Card>
        <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">Loading the schedule…</p>
      </Card>
    );
  }

  const handle = status.settings.accounts[0]?.label ?? "";

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {dates.map((date) => (
              <button
                key={date}
                onClick={() => setSelected(date)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  date === active
                    ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
                )}
              >
                {friendlyDate(date)}
              </button>
            ))}
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            {pending.length} still to post
            {pending.length > 0
              ? ` · ${clock(pending[0].publishAt)} → ${clock(pending[pending.length - 1].publishAt)}`
              : ""}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--muted-foreground)]">Move the whole batch:</span>
          {[-60, -15, 15, 60].map((minutes) => (
            <Button
              key={minutes}
              onClick={() =>
                send(
                  { action: "shift", date: active, minutes },
                  `shift${minutes}`,
                  (json) =>
                    `Moved ${json.moved ?? 0} posts ${Math.abs(minutes)} min ${minutes < 0 ? "earlier" : "later"}.`
                )
              }
              disabled={busy !== null || pending.length === 0}
            >
              {minutes > 0 ? `+${minutes}m` : `${minutes}m`}
            </Button>
          ))}
          <Button
            onClick={() =>
              send(
                { action: "plan", force: true },
                "replan",
                (json) => json.plan?.skipped ?? `Rebuilt with ${json.plan?.created ?? 0} posts.`
              )
            }
            disabled={busy !== null}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", busy === "replan" && "animate-spin")} />
            {busy === "replan" ? "Rebuilding…" : "Rebuild from a fresh pack"}
          </Button>
        </div>
      </Card>

      {batch.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">Nothing scheduled for this day yet.</p>
        </Card>
      ) : null}

      {batch.map((item) => (
        <Card key={item.id} className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/8 text-xs font-semibold text-white">
              {item.slot}
            </span>
            {item.status === "pending" ? (
              <Input
                type="datetime-local"
                defaultValue={toLocalInput(item.publishAt)}
                onBlur={(event) => {
                  const next = new Date(event.target.value);
                  if (Number.isNaN(next.getTime()) || next.toISOString() === item.publishAt) return;
                  void send({ action: "reschedule", id: item.id, at: next.toISOString() }, `time-${item.id}`, () =>
                    `Moved to ${clock(next.toISOString())}.`
                  );
                }}
                className="w-52"
              />
            ) : (
              <span className="text-sm font-semibold text-white">{clock(item.publishAt)}</span>
            )}
            <Badge
              className={cn(
                item.status === "published" && "text-emerald-200",
                item.status === "failed" && "text-rose-200",
                item.status === "skipped" && "text-amber-200"
              )}
            >
              {item.status}
            </Badge>
            <Badge>{item.topic}</Badge>
            {item.postId && handle ? (
              <a
                href={`https://www.threads.com/@${handle}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[var(--accent)] underline"
              >
                view on Threads
              </a>
            ) : null}
          </div>

          {editing === item.id ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={4}
                maxLength={500}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 text-sm text-white"
              />
              <div className="flex items-center gap-2">
                <Button
                  onClick={async () => {
                    const done = await send({ action: "edit", id: item.id, text: draft }, `edit-${item.id}`, () => "Updated.");
                    if (done) setEditing(null);
                  }}
                  disabled={busy !== null}
                >
                  <Check className="mr-2 h-4 w-4" />
                  Save
                </Button>
                <Button onClick={() => setEditing(null)} disabled={busy !== null}>
                  Cancel
                </Button>
                <span className="text-xs text-[var(--muted-foreground)]">{draft.length}/500</span>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm text-[var(--foreground)]">{item.text}</p>
          )}

          {item.error ? <p className="text-xs text-rose-200">{item.error}</p> : null}
          {item.note && item.status !== "pending" ? (
            <p className="text-xs text-[var(--muted-foreground)]">{item.note}</p>
          ) : null}

          {item.status === "pending" && editing !== item.id ? (
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  setEditing(item.id);
                  setDraft(item.text);
                }}
                disabled={busy !== null}
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                Edit copy
              </Button>
              <Button
                onClick={() => send({ action: "skip", id: item.id }, `skip-${item.id}`, () => "Skipped.")}
                disabled={busy !== null}
              >
                Skip
              </Button>
              <Button
                onClick={() => send({ action: "remove", id: item.id }, `remove-${item.id}`, () => "Removed.")}
                disabled={busy !== null}
              >
                Remove
              </Button>
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function PackSummary({ pack, now }: { pack: XDailyPack; now: number }) {
  const first = pack.posts[0];
  const last = pack.posts[pack.posts.length - 1];
  const ageMs = now - new Date(pack.createdAt).getTime();
  // A pack older than an hour is almost certainly a cached earlier run — flag it
  // amber so it's obvious you'd be copying yesterday-morning's batch.
  const stale = Number.isFinite(ageMs) && ageMs > 60 * 60 * 1000;
  const relative = relativeFrom(pack.createdAt, now);
  const took = durationSeconds(pack.requestedAt, pack.createdAt);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted-foreground)]">Today&apos;s pack · {pack.date}</p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            {pack.posts.length} posts · {pack.replies.length} replies
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {first && last ? (
            <Badge>
              {formatTime(first.time)} → {formatTime(last.time)}
            </Badge>
          ) : null}
          <Badge>~every 40 min</Badge>
          {pack.focus ? <Badge className="text-[var(--accent)]">Focus: {pack.focus}</Badge> : null}
          <Badge className={pack.source === "ai" ? "text-[var(--accent)]" : undefined}>
            {pack.source === "ai" ? "Claude-written" : "Idea library"}
          </Badge>
        </div>
      </div>

      <div
        className={cn(
          "mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-3 py-2 text-xs",
          stale
            ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
            : "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
        )}
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Clock className="h-3.5 w-3.5" />
          Generated {relative}
        </span>
        <span className="text-[var(--muted-foreground)]">
          Done {formatStamp(pack.createdAt)}
          {pack.requestedAt ? ` · clicked ${formatStamp(pack.requestedAt)}` : ""}
          {took !== null ? ` · took ${took}s` : ""}
        </span>
        {stale ? <span className="font-medium">This is an earlier batch — hit Generate for a fresh 24.</span> : null}
      </div>
    </Card>
  );
}

function ScheduleTab({ posts }: { posts: XSuggestedPost[] }) {
  return (
    <div className="relative space-y-4">
      {/* Timeline rail behind the time chips. */}
      <div aria-hidden className="absolute bottom-6 left-[52px] top-6 hidden w-px bg-white/10 sm:block" />
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}

function PostCard({ post }: { post: XSuggestedPost }) {
  const { copiedId, copy } = useCopy();
  const [showThreads, setShowThreads] = useState(false);
  const text = showThreads ? post.threadsVariant : post.text;
  const overLimit = !showThreads && post.text.length > 280;
  const nearLimit = !showThreads && post.text.length > 260;

  return (
    <div className="flex gap-4">
      <div className="relative z-10 hidden w-[104px] shrink-0 flex-col items-center pt-5 sm:flex">
        <span className="rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-1 text-xs font-semibold text-white">
          {formatTime(post.time)}
        </span>
      </div>
      <Card className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/8 text-xs font-semibold text-white">
            {post.slot}
          </span>
          <span className="text-xs font-semibold text-white sm:hidden">{formatTime(post.time)}</span>
          <span
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize",
              FORMAT_STYLES[post.format]
            )}
          >
            {post.format}
          </span>
          <span className="truncate text-xs text-[var(--muted-foreground)]">{post.topic}</span>
        </div>

        <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/90">{text}</p>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-white/5 p-0.5">
            <button
              type="button"
              onClick={() => setShowThreads(false)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition",
                !showThreads ? "bg-white/10 font-medium text-white" : "text-[var(--muted-foreground)] hover:text-white"
              )}
            >
              <AtSign className="h-3 w-3" /> X
            </button>
            <button
              type="button"
              onClick={() => setShowThreads(true)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition",
                showThreads ? "bg-white/10 font-medium text-white" : "text-[var(--muted-foreground)] hover:text-white"
              )}
            >
              <MessageSquare className="h-3 w-3" /> Threads
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "text-xs tabular-nums",
                overLimit ? "text-rose-300" : nearLimit ? "text-amber-300" : "text-[var(--muted-foreground)]"
              )}
            >
              {text.length} chars
            </span>
            <Button
              variant="secondary"
              className="px-3 py-1.5 text-xs"
              onClick={() => copy(`${post.id}:${showThreads ? "threads" : "x"}`, text)}
            >
              {copiedId === `${post.id}:${showThreads ? "threads" : "x"}` ? (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Copy className="mr-1.5 h-3.5 w-3.5" />
              )}
              Copy
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ExportTab({ pack, now }: { pack: XDailyPack; now: number }) {
  const { copiedId, copy } = useCopy();
  const csv = useMemo(() => toThreadsCsv(pack), [pack]);
  const json = useMemo(() => toThreadsJson(pack), [pack]);
  const base = exportBaseName(pack);

  const formats: Array<{
    id: string;
    label: string;
    hint: string;
    contents: string;
    filename: string;
    mime: string;
    language: string;
  }> = [
    {
      id: "csv",
      label: "CSV",
      hint: "One row per post — scheduled_at, date, time, format, topic, text. Imports into spreadsheets and most schedulers.",
      contents: csv,
      filename: `${base}.csv`,
      mime: "text/csv;charset=utf-8",
      language: "csv"
    },
    {
      id: "json",
      label: "JSON",
      hint: "Array of { slot, scheduledAt, date, time, format, topic, text } — for a Threads API script, webhook, or n8n/Make flow.",
      contents: json,
      filename: `${base}.json`,
      mime: "application/json;charset=utf-8",
      language: "json"
    }
  ];

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <div className="flex items-center gap-2 text-white">
          <CalendarClock className="h-4 w-4 text-[var(--accent)]" />
          <h3 className="font-semibold">Threads-ready schedule export</h3>
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">
          All {pack.posts.length} posts as their <span className="text-white/90">Threads variants</span> (never the X
          text), each paired with an absolute datetime built from {pack.date} plus the suggested time — ready to feed a
          scheduler. Regenerate first if this batch isn&apos;t fresh: it was generated {relativeFrom(pack.createdAt, now)}.
        </p>
      </Card>

      {formats.map((format) => (
        <Card key={format.id} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-white">{format.label}</h4>
              <p className="text-xs text-[var(--muted-foreground)]">{format.hint}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                onClick={() => copy(`export:${format.id}`, format.contents)}
              >
                {copiedId === `export:${format.id}` ? (
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                ) : (
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                )}
                Copy
              </Button>
              <Button
                className="px-3 py-1.5 text-xs"
                onClick={() => triggerDownload(format.filename, format.contents, format.mime)}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download
              </Button>
            </div>
          </div>
          <pre className="max-h-64 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--well)] p-3 text-[11px] leading-relaxed text-white/80">
            <code>{format.contents}</code>
          </pre>
        </Card>
      ))}
    </div>
  );
}

function RepliesTab({ replies }: { replies: XSuggestedReply[] }) {
  const { copiedId, copy } = useCopy();
  return (
    <div>
      <p className="mb-4 text-sm text-[var(--muted-foreground)]">
        Twenty adaptable replies for when you&apos;re scrolling — each is keyed to a kind of conversation you&apos;ll run
        into. Personalize a detail before posting so it reads as written in the moment, and never paste the same reply
        twice.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {replies.map((reply, index) => (
          <Card key={reply.id} className="flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--accent)]">
                  {String(index + 1).padStart(2, "0")} · {reply.scenario}
                </p>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-white/90">{reply.text}</p>
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => copy(reply.id, reply.text)}>
                {copiedId === reply.id ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                Copy
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

const GUARDRAILS: Array<{ title: string; body: string }> = [
  {
    title: "Human cadence, not clockwork",
    body: "Suggested times carry a few minutes of daily jitter on the ~2-hour rhythm. Posting exactly on the hour, every hour, every day is a classic automation fingerprint — drift a little, skip a slot when life happens."
  },
  {
    title: "Post from the app, by hand",
    body: "Copy from here and post manually. The pack gives you 24 distinct posts to choose from — you don't have to post them all. Genuinely distinct posts published by a human are fine; it's identical, machine-timed content that trips spam systems."
  },
  {
    title: "Never cross-post identical text",
    body: "Every post ships with a reworded Threads variant. Duplicate content across (and within) platforms is a downranking signal on both — always use the variant, never the same words twice."
  },
  {
    title: "Mix broadcasting with conversation",
    body: "Pure broadcast accounts get throttled. Use the reply bank between posting slots — a healthy ratio is roughly 2 replies for every original post you actually publish, which is what the 20-reply bank is for."
  },
  {
    title: "No hashtags, no bait, few links",
    body: "The brief already bans hashtags and engagement-bait phrasing. Also keep links out of most posts — link-heavy accounts see reduced reach. When you must link, put it in a reply to your own post."
  },
  {
    title: "Stay for the conversation",
    body: "After posting, hang around a few minutes and answer early replies. Real accounts converse; spam accounts fire and forget. The engagement window right after posting also does the most for reach."
  },
  {
    title: "Rest days are fine",
    body: "Missing a day is not a crisis — a natural weekly rhythm with lighter weekends looks more human than 70 identical weeks. Consistency over months beats perfection over days."
  },
  {
    title: "Fresh angles daily",
    body: "The generator sees your last two weeks of packs and avoids recycling angles, so followers (and ranking systems) never see you repeating yourself."
  }
];

function PlaybookTab() {
  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <div className="flex items-center gap-2 text-white">
          <Clock className="h-4 w-4 text-[var(--accent)]" />
          <h3 className="font-semibold">The daily system</h3>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--muted-foreground)]">
          <li>Hit Generate whenever you want fresh material: 24 originals + 20 replies, written against your positioning brief.</li>
          <li>Post at (or near) the suggested times, or cherry-pick your favourites — the pack is a menu, not a quota.</li>
          <li>Between posts, spend a few minutes scrolling and spend 2-3 replies from the bank, adapted to the actual post.</li>
          <li>Use the X text on X and the Threads variant on Threads, never the same wording on both.</li>
          <li>Every regeneration avoids the angles from your recent packs. Nothing you do here is logged or tracked.</li>
        </ol>
        <p className="text-xs text-[var(--muted-foreground)]">
          The voice, angles, and rules come from your positioning brief in Reply Studio settings — edit it there and every
          future pack follows.
        </p>
      </Card>

      <div>
        <div className="mb-3 flex items-center gap-2 text-white">
          <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
          <h3 className="font-semibold">Anti-spam / shadow-ban guardrails</h3>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {GUARDRAILS.map((rail) => (
            <Card key={rail.title} className="space-y-1.5">
              <h4 className="text-sm font-semibold text-white">{rail.title}</h4>
              <p className="text-sm text-[var(--muted-foreground)]">{rail.body}</p>
            </Card>
          ))}
        </div>
      </div>

      <Card className="space-y-2">
        <h3 className="font-semibold text-white">On your phone</h3>
        <p className="text-sm text-[var(--muted-foreground)]">
          A daily Claude routine delivers the same brief-driven pack to the Claude app each morning, so you can copy posts
          straight from your phone when you&apos;re away from the dashboard. Manage it from Claude&apos;s routines
          (&quot;Daily X/Threads content pack&quot;).
        </p>
      </Card>
    </div>
  );
}
