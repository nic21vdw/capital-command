import type { AwaitingEntry, ReviewChannel } from "@/lib/publisher/approval";
import { REVIEW_CHANNEL_LABELS, isReviewChannel } from "@/lib/publisher/approval";
import type { SurfaceControl, SurfaceField, SurfaceReading } from "@/lib/colateral/protocol";

export const AWAITING_SURFACE_CAP = 25;

export const APPROVE_ALL_ID = "approve-all";

export function approveControlId(channel: ReviewChannel, id: string): string {
  return `approve:${channel}:${id}`;
}

export function captionFieldId(channel: ReviewChannel, id: string): string {
  return `caption:${channel}:${id}`;
}

export function parseEntryId(prefix: "approve" | "caption", value: string): { channel: ReviewChannel; id: string } | null {
  const lead = `${prefix}:`;
  if (!value.startsWith(lead)) return null;
  const rest = value.slice(lead.length);
  const split = rest.indexOf(":");
  if (split < 0) return null;
  const channel = rest.slice(0, split);
  const id = rest.slice(split + 1);
  return isReviewChannel(channel) && id ? { channel, id } : null;
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
}

export function awaitingSurface(
  entries: AwaitingEntry[],
  busy: boolean
): { fields: SurfaceField[]; controls: SurfaceControl[]; readings: SurfaceReading[] } {
  const listed = entries.slice(0, AWAITING_SURFACE_CAP);
  return {
    readings: [{ label: "Awaiting approval", value: String(entries.length) }],
    fields: listed.map((entry) => ({
      id: captionFieldId(entry.channel, entry.id),
      label: `Caption for ${REVIEW_CHANNEL_LABELS[entry.channel]}: ${preview(entry.title || entry.caption)}`,
      value: entry.caption,
      kind: "longtext" as const
    })),
    controls: [
      {
        id: APPROVE_ALL_ID,
        label: entries.length > 0 ? `Approve all (${entries.length})` : "Approve all",
        group: "Awaiting approval",
        destructive: true,
        disabled: busy || entries.length === 0
      },
      ...listed.map((entry) => ({
        id: approveControlId(entry.channel, entry.id),
        label: `Approve ${REVIEW_CHANNEL_LABELS[entry.channel]}: ${preview(entry.title || entry.caption)}`,
        group: "Awaiting approval",
        destructive: true,
        disabled: busy
      }))
    ]
  };
}
