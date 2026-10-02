"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PodcastAutomation, PodcastDelivery } from "@/lib/podcast/types";

export type PodcastSchedulingStatus = {
  automation: PodcastAutomation;
  deliveries: Omit<PodcastDelivery, "filePath">[];
  paused: boolean;
  nextDueAt: string | null;
  counts: {
    scheduled: number;
    publishing: number;
    failed: number;
    published: number;
    cancelled: number;
  };
};

type Send = (
  action: string,
  body?: Record<string, unknown>,
) => Promise<boolean>;

function DeliveryRow({
  delivery,
  busy,
  send,
}: {
  delivery: Omit<PodcastDelivery, "filePath">;
  busy: boolean;
  send: Send;
}) {
  const [releaseAt, setReleaseAt] = useState("");
  const editable =
    delivery.status !== "published" && delivery.status !== "publishing";
  return (
    <li className="rounded-lg border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-white">{delivery.title}</p>
        <span className="text-xs capitalize text-[var(--muted-foreground)]">
          {delivery.status === "published" ? "Feed published" : delivery.status}
        </span>
      </div>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
        Release: {new Date(delivery.publishAt).toLocaleString()} -{" "}
        {delivery.attempts} attempt{delivery.attempts === 1 ? "" : "s"}
        {delivery.lastAttemptAt
          ? ` - Last attempt: ${new Date(delivery.lastAttemptAt).toLocaleString()}`
          : ""}
      </p>
      {delivery.lastError ? (
        <p className="mt-2 text-xs tone-warning tone-text">
          {delivery.lastError}
        </p>
      ) : null}
      {delivery.status === "failed" ? (
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          {delivery.blocked
            ? "Waiting for feed setup. Delivery resumes automatically after the issue is fixed."
            : delivery.nextAttemptAt
              ? `Retries at ${new Date(delivery.nextAttemptAt).toLocaleString()}`
              : "Automatic retries stopped. Fix the issue, then retry."}
        </p>
      ) : null}
      {editable ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {delivery.status === "failed" ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void send("retry-delivery", { deliveryId: delivery.id })
              }
            >
              Retry delivery
            </Button>
          ) : null}
          <Input
            type="datetime-local"
            aria-label={`New release time for ${delivery.title}`}
            className="w-auto"
            value={releaseAt}
            onChange={(event) => setReleaseAt(event.target.value)}
          />
          <Button
            variant="secondary"
            disabled={busy || !releaseAt}
            onClick={() =>
              void send("reschedule-delivery", {
                deliveryId: delivery.id,
                publishAt: new Date(releaseAt).toISOString(),
              })
            }
          >
            Save release time
          </Button>
          {delivery.status !== "cancelled" ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void send("cancel-delivery", { deliveryId: delivery.id })
              }
            >
              Cancel release
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function PodcastSchedulingCard({
  status,
  busy,
  send,
}: {
  status: PodcastSchedulingStatus;
  busy: boolean;
  send: Send;
}) {
  const [draft, setDraft] = useState(status.automation);
  return (
    <Card className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Scheduled podcast delivery
          </h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Finished pipeline MP3s are queued durably, one per daily slot. The
            server releases due episodes to the RSS feed even with this page
            closed. Spotify chooses when to ingest them.
          </p>
        </div>
        <a className="text-sm text-white underline" href="/automations">
          Manage all automations
        </a>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 py-2 text-sm text-white">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) =>
              setDraft({ ...draft, enabled: event.target.checked })
            }
          />{" "}
          Enable due releases
        </label>
        <label className="text-xs text-[var(--muted-foreground)]">
          Daily release time
          <Input
            type="time"
            value={draft.time}
            onChange={(event) =>
              setDraft({ ...draft, time: event.target.value })
            }
          />
        </label>
        <label className="text-xs text-[var(--muted-foreground)]">
          Time zone
          <Input
            value={draft.timeZone}
            placeholder="America/Toronto"
            onChange={(event) =>
              setDraft({ ...draft, timeZone: event.target.value })
            }
          />
        </label>
        <Button
          disabled={busy}
          onClick={() => void send("save-automation", { automation: draft })}
        >
          Save schedule
        </Button>
      </div>
      <p className="mt-3 text-xs text-[var(--muted-foreground)]">
        {status.paused
          ? "Paused in Automations. Resume there to release due episodes."
          : !status.automation.enabled
            ? "Due releases disabled. Queued episodes are retained."
            : status.nextDueAt
              ? `Next due: ${new Date(status.nextDueAt).toLocaleString()} (${status.automation.timeZone}).`
              : "No pending podcast releases."}{" "}
        Existing release times stay booked when the daily schedule changes. The
        app must be running; overdue releases resume after restart.
      </p>
      <p className="mt-2 text-xs text-[var(--muted-foreground)]">
        {status.counts.scheduled} scheduled - {status.counts.failed} need
        attention - {status.counts.published} published to feed
      </p>
      {status.deliveries.length ? (
        <ul className="mt-4 max-h-[32rem] space-y-3 overflow-auto">
          {status.deliveries.map((delivery) => (
            <DeliveryRow
              key={delivery.id}
              delivery={delivery}
              busy={busy}
              send={send}
            />
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
