"use client";

import { Check, ClipboardCheck, Pencil } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_REVIEW_POLICY,
  REVIEW_CHANNEL_LABELS,
  policyHolds,
  type AwaitingEntry,
  type ReviewPolicy
} from "@/lib/publisher/approval";
import { formatSlotDateTime } from "@/lib/timeFormat";

const REFRESH_MS = 30_000;

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `The request failed (${response.status}).`;
}

export type AwaitingApproval = {
  policy: ReviewPolicy;
  entries: AwaitingEntry[];
  loaded: boolean;
  busy: boolean;
  error: string | null;
  approve: (entry: Pick<AwaitingEntry, "channel" | "id">) => Promise<boolean>;
  approveAll: () => Promise<boolean>;
  saveCaption: (entry: Pick<AwaitingEntry, "channel" | "id">, caption: string) => Promise<boolean>;
  refresh: () => Promise<void>;
};

export function useAwaitingApproval(): AwaitingApproval {
  const [policy, setPolicy] = useState<ReviewPolicy>(DEFAULT_REVIEW_POLICY);
  const [entries, setEntries] = useState<AwaitingEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/review/awaiting", { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as { policy: ReviewPolicy; items: AwaitingEntry[] };
      if (!mounted.current) return;
      setPolicy(body.policy);
      setEntries(body.items);
      setError(null);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      mounted.current = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const act = useCallback(
    async (request: () => Promise<Response>): Promise<boolean> => {
      setBusy(true);
      try {
        const response = await request();
        if (!response.ok) throw new Error(await readError(response));
        setError(null);
        await refresh();
        return true;
      } catch (reason) {
        if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
        return false;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [refresh]
  );

  const approve = useCallback(
    (entry: Pick<AwaitingEntry, "channel" | "id">) =>
      act(() =>
        fetch("/api/review/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: entry.channel, id: entry.id })
        })
      ),
    [act]
  );

  const approveAll = useCallback(
    () =>
      act(() =>
        fetch("/api/review/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ all: true })
        })
      ),
    [act]
  );

  const saveCaption = useCallback(
    (entry: Pick<AwaitingEntry, "channel" | "id">, caption: string) =>
      act(() =>
        entry.channel === "threads"
          ? fetch("/api/threads", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "edit", id: entry.id, text: caption })
            })
          : fetch(`/api/publish/${encodeURIComponent(entry.id)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ caption })
            })
      ),
    [act]
  );

  return { policy, entries, loaded, busy, error, approve, approveAll, saveCaption, refresh };
}

function AwaitingRow({
  entry,
  timezone,
  busy,
  onApprove,
  onSave
}: {
  entry: AwaitingEntry;
  timezone: string;
  busy: boolean;
  onApprove: () => void;
  onSave: (caption: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.caption);
  const when = formatSlotDateTime(entry.publishAt, timezone, { weekday: true });
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">{REVIEW_CHANNEL_LABELS[entry.channel]}</Badge>
        <span className="text-xs text-[var(--muted-foreground)]">{when}</span>
        {entry.channel !== "threads" && entry.title ? (
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{entry.title}</span>
        ) : (
          <span className="flex-1" />
        )}
        <Button
          variant="secondary"
          className="h-8 px-3 text-xs"
          disabled={busy}
          onClick={() => {
            setDraft(entry.caption);
            setEditing((open) => !open);
          }}
        >
          <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Edit caption
        </Button>
        <Button className="h-8 px-3 text-xs" disabled={busy} onClick={onApprove}>
          <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Approve
        </Button>
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            aria-label={`Caption for ${entry.title || REVIEW_CHANNEL_LABELS[entry.channel]}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-20"
          />
          <div className="flex gap-2">
            <Button
              className="h-8 px-3 text-xs"
              disabled={busy || !draft.trim()}
              onClick={() => void onSave(draft).then((saved) => saved && setEditing(false))}
            >
              Save caption
            </Button>
            <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="line-clamp-3 whitespace-pre-line text-sm text-[var(--muted-foreground)]">{entry.caption}</p>
      )}
    </li>
  );
}

export function AwaitingApprovalCard({ approval, timezone }: { approval: AwaitingApproval; timezone: string }) {
  const { policy, entries, loaded, busy, error } = approval;
  if (!loaded && entries.length === 0) return null;
  if (entries.length === 0 && !policyHolds(policy) && !error) return null;
  return (
    <Card className="mb-4 space-y-2" aria-label="Awaiting approval">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <ClipboardCheck className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
          Awaiting approval ({entries.length})
        </h2>
        <span className="flex-1" />
        <Button className="h-8 px-3 text-xs" disabled={busy || entries.length === 0} onClick={() => void approval.approveAll()}>
          Approve all
        </Button>
      </div>
      {error ? <p className="text-xs text-amber-200">{error}</p> : null}
      {entries.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          Nothing is waiting. Posts on a channel set to hold show up here before they go out.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {entries.map((entry) => (
            <AwaitingRow
              key={entry.key}
              entry={entry}
              timezone={timezone}
              busy={busy}
              onApprove={() => void approval.approve(entry)}
              onSave={(caption) => approval.saveCaption(entry, caption)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
