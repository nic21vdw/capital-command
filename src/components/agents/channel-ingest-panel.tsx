"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, TriangleAlert, Youtube } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type ScanSummary = {
  id: string;
  status: "running" | "completed" | "failed";
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  log: string[];
  configured?: boolean;
  needsReconnect?: boolean;
  needsReview?: Array<{ videoId: string; title: string; reason: string }>;
};

type Overview = {
  lastScanAt: string | null;
  taken: Array<{ videoId: string; title: string; runId: string | null; outcome: string; summary: string }>;
  running: ScanSummary | null;
  lastScan: ScanSummary | null;
  abandoned: Array<{ videoId: string; title: string; attempts: number; outcome: string; summary: string }>;
  maxAttempts: number;
};

export function ChannelIngestPanel() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/ingest", { cache: "no-store" });
    if (!response.ok) return;
    setOverview((await response.json()) as Overview);
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    if (!overview?.running) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [overview?.running, load]);

  async function scan(dryRun: boolean) {
    setBusy(true);
    try {
      const response = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun })
      });
      if (!response.ok) throw new Error("Could not start the channel scan.");
      toast.success(dryRun ? "Checking the channel." : "Taking new streams into the pipeline.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start the channel scan.");
    } finally {
      setBusy(false);
    }
  }

  const running = overview?.running ?? null;
  const lastScan = running ? null : overview?.lastScan ?? null;
  const needsReview = lastScan?.needsReview ?? [];
  const abandoned = overview?.abandoned ?? [];

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Youtube className="h-4 w-4 text-[var(--accent)]" />
          <h2 className="font-semibold text-white">Channel ingest</h2>
        </div>
        <button onClick={() => void load()} aria-label="Refresh channel ingest" className="text-[var(--muted-foreground)] hover:text-white">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
        New streams on your channel go through the whole Stream Pipeline and stop at ready to schedule. Nothing is published.
      </p>

      <div className="mt-3 flex gap-2">
        <Button variant="secondary" className="flex-1 px-3 py-1.5 text-xs" disabled={busy || Boolean(running)} onClick={() => void scan(true)}>
          Check
        </Button>
        <Button className="flex-1 px-3 py-1.5 text-xs" disabled={busy || Boolean(running)} onClick={() => void scan(false)}>
          Take in new
        </Button>
      </div>

      {running ? (
        <div className="mt-3 rounded-lg border border-[var(--accent)]/25 bg-[var(--accent)]/8 p-3">
          <span className="flex items-center gap-2 text-xs font-medium text-white">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent)]" />
            {running.dryRun ? "Checking the channel" : "Taking new streams in"}
          </span>
          <div className="mt-2 max-h-32 space-y-0.5 overflow-y-auto font-mono text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            {running.log.slice(-12).map((line, index) => (
              <div key={`${index}-${line.slice(0, 12)}`} className="truncate">
                {line}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {lastScan?.status === "failed" ? (
        <div className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 p-3">
          <span className="flex items-center gap-2 text-xs font-medium text-red-200">
            <TriangleAlert className="h-3.5 w-3.5" />
            The last scan failed
          </span>
          <p className="mt-1 text-[11px] leading-relaxed text-red-100/80">{lastScan.error ?? "No reason was recorded."}</p>
          <div className="mt-2 max-h-24 space-y-0.5 overflow-y-auto font-mono text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            {lastScan.log.slice(-6).map((line, index) => (
              <div key={`${index}-${line.slice(0, 12)}`} className="truncate">
                {line}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {lastScan?.status === "completed" && lastScan.configured === false ? (
        <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-[11px] leading-relaxed text-amber-100">
          YouTube is not connected, so there is nothing to scan.{" "}
          <Link href="/uploading-center" className="text-white underline decoration-white/30 underline-offset-4">
            Connect the channel
          </Link>
        </div>
      ) : null}

      {lastScan?.needsReconnect ? (
        <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-[11px] leading-relaxed text-amber-100">
          The YouTube sign-in can no longer read the channel — nothing will be taken in until it is reconnected.{" "}
          <Link href="/uploading-center" className="text-white underline decoration-white/30 underline-offset-4">
            Reconnect YouTube
          </Link>
        </div>
      ) : null}

      {needsReview.length ? (
        <div className="mt-3 space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Skipped — worth a look
          </span>
          {needsReview.slice(0, 5).map((candidate) => (
            <div key={candidate.videoId} className="rounded-lg bg-white/[0.03] px-2.5 py-2">
              <span className="block truncate text-xs text-white">{candidate.title}</span>
              <span className="mt-0.5 block text-[11px] text-[var(--muted-foreground)]">{candidate.reason}</span>
            </div>
          ))}
        </div>
      ) : null}

      {abandoned.length ? (
        <div className="mt-3 space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Given up after {overview?.maxAttempts} tries
          </span>
          {abandoned.slice(0, 5).map((record) => (
            <div key={record.videoId} className="rounded-lg bg-white/[0.03] px-2.5 py-2">
              <span className="block truncate text-xs text-white">{record.title}</span>
              <span className="mt-0.5 flex items-center gap-1.5">
                <Badge>{record.outcome}</Badge>
                <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--muted-foreground)]">{record.summary}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {overview?.taken.length ? (
        <div className="mt-3 space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Already taken in</span>
          {overview.taken.slice(0, 5).map((record) => (
            <div key={record.videoId} className="rounded-lg bg-white/[0.03] px-2.5 py-2">
              <span className="block truncate text-xs text-white">{record.title}</span>
              <span className="mt-0.5 flex items-center gap-1.5">
                <Badge>{record.outcome}</Badge>
                <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--muted-foreground)]">{record.summary}</span>
              </span>
            </div>
          ))}
        </div>
      ) : lastScan?.status === "failed" ? null : (
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">
          {overview?.lastScanAt ? "Nothing taken in yet." : "No scan has run in this copy of the app yet."}
        </p>
      )}
    </Card>
  );
}
