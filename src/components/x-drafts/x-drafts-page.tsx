"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, PenLine, RefreshCw, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { useColateralSurface } from "@/lib/colateral/useSurface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, LoadingState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { draftThreadsLabel, dayHeading, slotLabel, summarizeDrafts } from "@/lib/x-drafts/display";
import type { XDraft } from "@/lib/x-drafts/types";

type Status = {
  today: string;
  timezone: string;
  settings: { enabled: boolean; perDay: number; slots: string[]; threads: boolean; threadsOffsetMinutes: number; writeAheadHour: number };
  threadsBlockedReason: string | null;
  writing: string | null;
  nextDate: string | null;
  lastWrite: { at: string; date: string; created: number; error?: string } | null;
  phonePage: { url?: string; at: string; error?: string } | null;
  drafts: XDraft[];
};

export function XDraftsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/x-drafts", { cache: "no-store" });
    if (response.ok) setStatus((await response.json()) as Status);
  }, []);

  useEffect(() => {
    let live = true;
    const refresh = () => {
      fetch("/api/x-drafts", { cache: "no-store" })
        .then((response) => (response.ok ? (response.json() as Promise<Status>) : null))
        .then((json) => {
          if (live && json) setStatus(json);
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const send = useCallback(
    async (body: Record<string, unknown>, key: string, done?: (json: Record<string, unknown>) => string | null) => {
      setBusy(key);
      try {
        const response = await fetch("/api/x-drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) toast.error(String(json.error ?? "That did not work."));
        else {
          const message = done?.(json);
          if (message) toast.success(message);
        }
      } finally {
        setBusy(null);
        await load();
      }
    },
    [load]
  );

  const writeMore = useCallback(
    () =>
      send({ action: "write" }, "write", (json) => {
        const outcome = json.outcome as { date: string; created: number; booked: number } | undefined;
        return outcome ? `${outcome.created} drafts for ${dayHeading(outcome.date)}, ${outcome.booked} booked on Threads.` : null;
      }),
    [send]
  );

  const copy = useCallback(async (draft: XDraft) => {
    try {
      await navigator.clipboard.writeText(draft.text);
      toast.success("Copied. Paste it into X.");
    } catch {
      toast.error("The browser would not copy it. Select the text instead.");
    }
  }, []);

  const drafts = status?.drafts ?? [];
  const summary = summarizeDrafts(drafts);
  const writing = busy === "write" || Boolean(status?.writing);
  const canWrite = Boolean(status?.settings.enabled && status.nextDate) && !writing;

  useColateralSurface({
    route: "/x-drafts",
    title: "X Drafts",
    summary: "X posts written in Nic's voice to pick from. He posts the ones he likes to X himself; each draft also goes to Threads on its own.",
    fields: [],
    controls: [
      { id: "write-more", label: "Write another day of drafts", group: "Compose", destructive: true, disabled: !canWrite },
      { id: "phone-page", label: "Update the phone page", group: "Manual", disabled: busy !== null }
    ],
    readings: [
      { label: "Drafts waiting", value: String(summary.waiting) },
      { label: "Posted on X", value: String(summary.postedOnX) },
      { label: "Booked on Threads", value: String(summary.onThreads) },
      { label: "Next day to write", value: status?.nextDate ? dayHeading(status.nextDate) : "-" },
      { label: "Phone page", value: status?.phonePage?.url ?? status?.phonePage?.error ?? "Not published yet" }
    ],
    click: (id) => {
      if (id === "write-more") {
        if (!canWrite) return false;
        void writeMore();
        return true;
      }
      if (id === "phone-page") {
        if (busy !== null) return false;
        void send({ action: "phone-page" }, "phone", () => "Phone page updated.");
        return true;
      }
      return false;
    }
  });

  const days = [...new Set(drafts.map((draft) => draft.batchDate))];

  return (
    <div>
      <PageHeader
        title="X Drafts"
        description={`A fresh day of X posts in your voice is written every evening. Copy the ones you like to X. Every draft you don't dismiss also posts to Threads${status ? ` about ${status.settings.threadsOffsetMinutes} minutes after its X time` : ""}.`}
        actions={
          <Button onClick={() => void writeMore()} disabled={!canWrite}>
            {writing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <PenLine className="mr-2 h-4 w-4" />}
            {writing ? "Writing…" : status?.nextDate ? `Write drafts for ${dayHeading(status.nextDate)}` : "Write more drafts"}
          </Button>
        }
      />

      {status?.threadsBlockedReason ? (
        <p className="mb-4 rounded-xl border p-3 text-sm tone-warning tone-soft tone-edge tone-text">
          Threads cannot post right now: {status.threadsBlockedReason}
        </p>
      ) : null}
      {status?.lastWrite?.error ? (
        <p className="mb-4 rounded-xl border p-3 text-sm tone-warning tone-soft tone-edge tone-text">
          The last batch ({dayHeading(status.lastWrite.date)}) did not finish: {status.lastWrite.error}
        </p>
      ) : null}

      <Card className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm">
          <Smartphone className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
          {status?.phonePage?.url ? (
            <span>
              On your phone:{" "}
              <a href={status.phonePage.url} target="_blank" rel="noreferrer" className="break-all text-[var(--accent)] underline underline-offset-2">
                {status.phonePage.url}
              </a>
            </span>
          ) : (
            <span className="text-[var(--muted-foreground)]">{status?.phonePage?.error ?? "The phone page appears here after the first batch is written."}</span>
          )}
        </div>
        <div className="flex gap-2">
          {status?.phonePage?.url ? (
            <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(status.phonePage!.url!).then(() => toast.success("Link copied."))}>
              <Copy className="mr-2 h-4 w-4" /> Copy link
            </Button>
          ) : null}
          <Button variant="secondary" disabled={busy !== null} onClick={() => void send({ action: "phone-page" }, "phone", () => "Phone page updated.")}>
            Update phone page
          </Button>
        </div>
      </Card>

      {!status ? (
        <LoadingState />
      ) : drafts.length === 0 ? (
        <EmptyState
          icon={PenLine}
          title="No drafts yet"
          description={status.settings.enabled ? `Tomorrow's drafts are written after ${status.settings.writeAheadHour}:00, or press the button to write some now.` : "X drafts are switched off (X_DRAFTS=off)."}
        />
      ) : (
        days.map((date) => (
          <section key={date} className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{dayHeading(date)}</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {drafts
                .filter((draft) => draft.batchDate === date)
                .map((draft) => (
                  <Card key={draft.id} className={draft.status === "dismissed" ? "opacity-50" : undefined}>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-white">{slotLabel(draft.time)} on X</span>
                      <div className="flex flex-wrap gap-1.5">
                        {draft.status === "posted-x" ? <Badge tone="success">Posted on X</Badge> : null}
                        <Badge tone={draft.threadsAt && draft.status !== "dismissed" ? "info" : "neutral"}>{draftThreadsLabel(draft, status.timezone)}</Badge>
                      </div>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-[var(--foreground)]">{draft.text}</p>
                    {draft.reply ? <p className="mt-3 text-xs text-[var(--muted-foreground)]">Reply under it on X: {draft.reply}</p> : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button onClick={() => void copy(draft)} disabled={draft.status === "dismissed"}>
                        <Copy className="mr-2 h-4 w-4" /> Copy for X
                      </Button>
                      {draft.status === "new" ? (
                        <>
                          <Button variant="secondary" disabled={busy !== null} onClick={() => void send({ action: "posted-x", id: draft.id }, draft.id)}>
                            <Check className="mr-2 h-4 w-4" /> Posted on X
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy !== null}
                            onClick={() =>
                              void send({ action: "dismiss", id: draft.id }, draft.id, (json) =>
                                json.threads === "already-sent" ? "Dismissed. It had already gone to Threads." : "Dismissed. It won't go to Threads."
                              )
                            }
                          >
                            <X className="mr-2 h-4 w-4" /> Don&apos;t post
                          </Button>
                        </>
                      ) : draft.status === "posted-x" ? (
                        <Button variant="ghost" disabled={busy !== null} onClick={() => void send({ action: "restore", id: draft.id }, draft.id)}>
                          Undo
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
