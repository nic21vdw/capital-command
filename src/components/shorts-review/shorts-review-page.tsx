"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, CheckSquare, Film, RefreshCw, Square, X } from "lucide-react";
import { toast } from "sonner";
import { ClipFrame } from "@/components/clips/clip-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, LoadingState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { useColateralSurface } from "@/lib/colateral/useSurface";
import type { ReviewClip, ShortsReviewState } from "@/lib/pipeline/shortsReview";
import { bookingSummary, durationLabel, fillTheWeek, platformLabel, runwayLine, slotLabel, type BookReply } from "@/lib/pipeline/shortsReviewDisplay";

type Reply = Omit<BookReply, "booked"> & { booked: { title: string; publishAt: string; platforms: string[] }[] };

function fileUrl(jobId: string, fileName: string) {
  return `/api/clips/${jobId}/files/${encodeURIComponent(fileName)}`;
}

async function readReview(): Promise<{ state: ShortsReviewState } | { error: string }> {
  try {
    const response = await fetch("/api/shorts-review", { cache: "no-store" });
    const json = (await response.json().catch(() => ({}))) as ShortsReviewState & { error?: string };
    return response.ok ? { state: json } : { error: json.error ?? "The review could not be read." };
  } catch {
    return { error: "The app did not answer. Check that it is running, then reload." };
  }
}

export function ShortsReviewPage() {
  const [state, setState] = useState<ShortsReviewState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Set<string>>(() => new Set());
  const [stream, setStream] = useState<string>("all");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"book" | "skip" | null>(null);
  const [lastReply, setLastReply] = useState<Reply | null>(null);

  const apply = useCallback((result: { state: ShortsReviewState } | { error: string }) => {
    if ("error" in result) {
      setLoadError(result.error);
      return;
    }
    setLoadError(null);
    setState(result.state);
    const waiting = new Set(result.state.clips.map((clip) => clip.candidateId));
    setPicks((current) => new Set([...current].filter((id) => waiting.has(id))));
  }, []);

  const load = useCallback(async () => apply(await readReview()), [apply]);

  useEffect(() => {
    let live = true;
    void readReview().then((result) => {
      if (live) apply(result);
    });
    return () => {
      live = false;
    };
  }, [apply]);

  const clips = useMemo(() => state?.clips ?? [], [state]);
  const shown = stream === "all" ? clips : clips.filter((clip) => clip.runId === stream);
  const suggested = state ? fillTheWeek(state.runway, clips.length) : 0;
  const blocked = Boolean(state?.problem);

  const toggle = (id: string) => {
    setConfirming(false);
    setPicks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const tickBest = useCallback(() => {
    setConfirming(false);
    setPicks(new Set(clips.slice(0, suggested).map((clip) => clip.candidateId)));
  }, [clips, suggested]);

  const post = useCallback(
    async (body: Record<string, unknown>, kind: "book" | "skip") => {
      setBusy(kind);
      try {
        const response = await fetch("/api/shorts-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) {
          toast.error(String(json.error ?? "That did not work."));
          return null;
        }
        return json;
      } catch {
        toast.error(
          kind === "book"
            ? "The connection dropped before the app answered. The list is reloading to show what was booked; pressing Book again is safe, because clips already booked are skipped."
            : "The connection dropped before the app answered. The list is reloading."
        );
        return null;
      } finally {
        setBusy(null);
        setConfirming(false);
        await load();
      }
    },
    [load]
  );

  const book = useCallback(async () => {
    if (busy || picks.size === 0 || blocked) return;
    const reply = (await post({ action: "book", ids: [...picks], confirm: true }, "book")) as Reply | null;
    if (!reply) return;
    setLastReply(reply);
    const summary = bookingSummary(reply);
    toast[summary.tone](summary.text);
  }, [blocked, busy, picks, post]);

  const skip = useCallback(
    async (clip: ReviewClip) => {
      if (busy) return;
      const reply = (await post({ action: "skip", ids: [clip.candidateId] }, "skip")) as { skipped: number } | null;
      if (reply?.skipped) toast.success(`Skipped "${clip.title}". Tick it on ${clip.stream}'s booking sheet to bring it back.`);
    },
    [busy, post]
  );

  useColateralSurface({
    route: "/shorts-review",
    title: "Weekly Shorts Review",
    summary: "Every finished Short from recent streams that is not booked yet, best first. Nic ticks the ones to post; nothing is ticked or booked for him.",
    fields: [],
    controls: [
      { id: "tick-best", label: `Tick the best ${suggested} to fill the week`, group: "Pick", disabled: suggested === 0 || busy !== null },
      { id: "book", label: `Book ${picks.size} ticked Shorts`, group: "Book", destructive: true, disabled: picks.size === 0 || busy !== null || blocked }
    ],
    readings: [
      { label: "Waiting", value: String(clips.length) },
      { label: "Ticked", value: String(picks.size) },
      ...(state?.runway ?? []).map((entry) => ({ label: `${platformLabel(entry.platform)} next ${state?.runwayDays ?? 7} days`, value: `${entry.booked} of ${entry.expected}` }))
    ],
    click: (id) => {
      if (id === "tick-best") {
        if (suggested === 0 || busy) return false;
        tickBest();
        return true;
      }
      if (id === "book") {
        if (picks.size === 0 || busy || blocked) return false;
        void book();
        return true;
      }
      return false;
    }
  });

  return (
    <div>
      <PageHeader
        title="Weekly Shorts Review"
        description="Every finished Short from the last 3 weeks of streams that is not booked yet, strongest first. Tick the ones you want posted and book them in one go. Nothing is ticked for you, and anything you leave unticked stays here for next week."
        actions={
          <Button variant="secondary" onClick={() => void load()} disabled={busy !== null}>
            <RefreshCw className="mr-2 h-4 w-4" /> Reload
          </Button>
        }
      />

      {loadError ? <p className="mb-4 rounded-xl border p-3 text-sm tone-danger tone-soft tone-edge tone-text">{loadError}</p> : null}
      {state?.problem ? <p className="mb-4 rounded-xl border p-3 text-sm tone-warning tone-soft tone-edge tone-text">Booking is unavailable: {state.problem}</p> : null}

      {state ? (
        <Card className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-sm">
            <p className="font-medium">
              Booked for the next {state.runwayDays} days at {state.shortsPerDay} a day: {state.runway.map(runwayLine).join(", ") || "no platforms switched on"}.
            </p>
            <p className="text-[var(--muted-foreground)]">
              {clips.length} waiting from {state.streams.filter((entry) => entry.waiting > 0).length} streams. Read {slotLabel(state.observedAt, state.timezone)}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={tickBest} disabled={suggested === 0 || busy !== null}>
              <CheckSquare className="mr-2 h-4 w-4" /> {suggested ? `Tick the best ${suggested} to fill the week` : "The week is full"}
            </Button>
            {picks.size ? (
              <Button variant="ghost" onClick={() => setPicks(new Set())} disabled={busy !== null}>
                Clear ticks
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {state && state.streams.filter((entry) => entry.waiting > 0).length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by stream">
          {[{ runId: "all", name: "All streams", waiting: clips.length }, ...state.streams.filter((entry) => entry.waiting > 0)].map((entry) => (
            <Button key={entry.runId} variant={stream === entry.runId ? "primary" : "secondary"} className="h-8 px-3 text-xs" onClick={() => setStream(entry.runId)} aria-pressed={stream === entry.runId}>
              {entry.name} ({entry.waiting})
            </Button>
          ))}
        </div>
      ) : null}

      {state ? (
        <div className="sticky top-2 z-20 mb-4 rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 shadow-[var(--shadow)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              {confirming
                ? `Book ${picks.size} Short${picks.size === 1 ? "" : "s"} into the next free slots from tomorrow on ${state.platforms.map(platformLabel).join(", ")}? They post at their slots. Review holds still apply.`
                : `${picks.size} ticked`}
            </p>
            <div className="flex gap-2">
              {confirming ? (
                <>
                  <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy !== null}>
                    Cancel
                  </Button>
                  <Button onClick={() => void book()} disabled={busy !== null}>
                    {busy === "book" ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CalendarCheck className="mr-2 h-4 w-4" />}
                    {busy === "book" ? "Booking…" : "Yes, book them"}
                  </Button>
                </>
              ) : (
                <Button onClick={() => setConfirming(true)} disabled={picks.size === 0 || busy !== null || blocked}>
                  <CalendarCheck className="mr-2 h-4 w-4" /> Book {picks.size || ""} ticked
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {!state && !loadError ? (
        <LoadingState />
      ) : state && clips.length === 0 ? (
        <EmptyState icon={Film} title="Nothing waiting" description="Every finished Short from the last 3 weeks is booked or decided. New ones appear here as streams finish rendering." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((clip) => {
            const ticked = picks.has(clip.candidateId);
            return (
              <Card key={clip.candidateId} className={`flex flex-col overflow-hidden rounded-2xl p-1.5 ${ticked ? "ring-2 ring-[var(--accent)]" : ""}`}>
                <ClipFrame
                  src={fileUrl(clip.jobId, clip.file)}
                  poster={clip.posterFile ? fileUrl(clip.jobId, clip.posterFile) : undefined}
                  preload={clip.posterFile ? "none" : "metadata"}
                  controls
                />
                <div className="flex flex-1 flex-col gap-2 p-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge tone={clip.score >= 80 ? "success" : "neutral"}>Score {Math.round(clip.score)}</Badge>
                    <Badge>{durationLabel(clip.durationSec)}</Badge>
                    <Badge tone="info">{clip.stream}</Badge>
                    {clip.framing ? <Badge>{clip.framing}</Badge> : null}
                  </div>
                  <p className="text-sm font-semibold leading-snug">{clip.title}</p>
                  {clip.hookQuote ? <p className="text-xs text-[var(--muted-foreground)]">Opens on: “{clip.hookQuote}”</p> : null}
                  <div className="mt-auto flex gap-2 pt-1">
                    <Button variant={ticked ? "primary" : "secondary"} className="flex-1" onClick={() => toggle(clip.candidateId)} aria-pressed={ticked} disabled={busy !== null}>
                      {ticked ? <CheckSquare className="mr-2 h-4 w-4" /> : <Square className="mr-2 h-4 w-4" />}
                      {ticked ? "Ticked" : "Tick to book"}
                    </Button>
                    <Button variant="ghost" onClick={() => void skip(clip)} disabled={busy !== null} title="Not wanted. It leaves this list; tick it on the stream's booking sheet to bring it back.">
                      <X className="mr-1 h-4 w-4" /> Skip
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {lastReply && (lastReply.booked.length || lastReply.failed.length) ? (
        <Card className="mt-6 text-sm">
          <p className="mb-2 font-semibold">Last booking</p>
          {lastReply.booked.map((entry, index) => (
            <p key={`b${index}`}>
              {entry.title}: {state ? slotLabel(entry.publishAt, state.timezone) : entry.publishAt} on {entry.platforms.map(platformLabel).join(", ")}
            </p>
          ))}
          {lastReply.failed.map((entry, index) => (
            <p key={`f${index}`} className="tone-danger tone-text">
              {entry.title}: {entry.error}
            </p>
          ))}
        </Card>
      ) : null}

    </div>
  );
}
