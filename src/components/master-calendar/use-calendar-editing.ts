"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  editableTarget,
  movedToDay,
  nudgedBy,
  rescheduleRequest,
  rewriteRequest,
  skipRequest,
  type CalendarWrite
} from "@/lib/master-calendar/editing";
import type { MasterCalendarEvent } from "@/lib/master-calendar/types";

export const CALENDAR_DRAG_TYPE = "application/x-capital-calendar-event";

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

/**
 * Editing straight from a calendar cell. Writes go to whichever system owns
 * the event — the publish queue or the Threads autopilot — through the same
 * routes their own screens use, so the rules about what may change live in one
 * place and a refusal comes back as the sentence the server wrote.
 */
export function useCalendarEditing(timeZone: string, onChanged: () => void) {
  const [busy, setBusy] = useState<string | null>(null);

  const send = useCallback(
    async (event: MasterCalendarEvent, write: CalendarWrite, success: string) => {
      setBusy(event.id);
      try {
        const response = await fetch(write.url, {
          method: write.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(write.body)
        });
        if (!response.ok) {
          toast.error(await readError(response));
          return false;
        }
        toast.success(success);
        onChanged();
        return true;
      } catch {
        toast.error("Couldn't reach the server.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [onChanged]
  );

  const moveToDay = useCallback(
    async (event: MasterCalendarEvent, dateKey: string) => {
      const target = editableTarget(event);
      const publishAt = movedToDay(event, dateKey, timeZone);
      if (!target || !publishAt) {
        if (event.edit?.lockedReason) toast.error(event.edit.lockedReason);
        return false;
      }
      return send(event, rescheduleRequest(target, publishAt), `Moved to ${dateKey}.`);
    },
    [send, timeZone]
  );

  const nudge = useCallback(
    async (event: MasterCalendarEvent, minutes: number) => {
      const target = editableTarget(event);
      const publishAt = nudgedBy(event, minutes);
      if (!target || !publishAt) return false;
      const direction = minutes > 0 ? "later" : "earlier";
      return send(event, rescheduleRequest(target, publishAt), `Moved ${Math.abs(minutes)} min ${direction}.`);
    },
    [send]
  );

  const rewrite = useCallback(
    async (event: MasterCalendarEvent, text: string) => {
      const target = editableTarget(event);
      if (!target) return false;
      return send(event, rewriteRequest(target, text), "Copy updated.");
    },
    [send]
  );

  const skip = useCallback(
    async (event: MasterCalendarEvent) => {
      const target = editableTarget(event);
      if (!target) return false;
      return send(event, skipRequest(target), "Skipped — it won't post.");
    },
    [send]
  );

  return { busy, moveToDay, nudge, rewrite, skip };
}
