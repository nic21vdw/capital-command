import { zonedToUtc } from "@/lib/publisher/time";
import type { CalendarEditTarget, MasterCalendarEvent } from "@/lib/master-calendar/types";

export function editableTarget(event: MasterCalendarEvent): CalendarEditTarget | null {
  if (!event.edit || event.edit.lockedReason) return null;
  return event.edit;
}

/**
 * The instant an event lands on when dropped on another day. The wall-clock
 * time is carried across rather than the elapsed milliseconds, so a post that
 * runs at 19:30 still runs at 19:30 on the far side of a DST boundary.
 */
export function movedToDay(event: MasterCalendarEvent, dateKey: string, timeZone: string): string | null {
  const target = editableTarget(event);
  if (!target) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  if (dateKey === event.dateKey) return null;

  const [hour, minute] = (event.time ?? "00:00").split(":").map(Number);
  const [year, month, day] = dateKey.split("-").map(Number);
  return zonedToUtc(timeZone, year, month, day, hour, minute, 0).toISOString();
}

export function nudgedBy(event: MasterCalendarEvent, minutes: number): string | null {
  const target = editableTarget(event);
  if (!target || minutes === 0) return null;
  return new Date(new Date(target.publishAt).getTime() + minutes * 60_000).toISOString();
}

export type CalendarWrite =
  | { url: string; method: "PATCH"; body: Record<string, unknown> }
  | { url: string; method: "POST"; body: Record<string, unknown> };

export function rescheduleRequest(target: CalendarEditTarget, publishAt: string): CalendarWrite {
  if (target.kind === "queue") {
    return { url: `/api/publish/${target.id}`, method: "PATCH", body: { publishAt } };
  }
  return { url: "/api/threads", method: "POST", body: { action: "reschedule", id: target.id, at: publishAt } };
}

export function rewriteRequest(target: CalendarEditTarget, text: string): CalendarWrite {
  if (target.kind === "queue") {
    return { url: `/api/publish/${target.id}`, method: "PATCH", body: { caption: text } };
  }
  return { url: "/api/threads", method: "POST", body: { action: "edit", id: target.id, text } };
}

export function skipRequest(target: CalendarEditTarget): CalendarWrite {
  if (target.kind === "queue") {
    return { url: `/api/publish/${target.id}/skip`, method: "POST", body: {} };
  }
  return { url: "/api/threads", method: "POST", body: { action: "skip", id: target.id } };
}
