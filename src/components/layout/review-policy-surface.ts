import type { SurfaceField, SurfaceReading } from "@/lib/colateral/protocol";
import {
  REVIEW_CHANNELS,
  REVIEW_CHANNEL_LABELS,
  REVIEW_MODES,
  isReviewChannel,
  isReviewMode,
  type ReviewChannel,
  type ReviewMode,
  type ReviewPolicy
} from "@/lib/publisher/approval";

const FIELD_PREFIX = "review-";

export function reviewFieldId(channel: ReviewChannel): string {
  return `${FIELD_PREFIX}${channel}`;
}

export function reviewPolicySurface(policy: ReviewPolicy): { fields: SurfaceField[]; readings: SurfaceReading[] } {
  const held = REVIEW_CHANNELS.filter((channel) => policy[channel] === "hold");
  return {
    fields: REVIEW_CHANNELS.map((channel) => ({
      id: reviewFieldId(channel),
      label: `Review ${REVIEW_CHANNEL_LABELS[channel]} before posting`,
      value: policy[channel],
      kind: "select" as const,
      options: [...REVIEW_MODES],
      hint: "auto posts at its slot. hold keeps new posts for approval on the Uploading Center. The canvas can set hold. Setting auto releases what is waiting and takes a person on the Settings screen."
    })),
    readings: [
      {
        label: "Channels held for approval",
        value: held.length ? held.map((channel) => REVIEW_CHANNEL_LABELS[channel]).join(", ") : "None"
      }
    ]
  };
}

export function canvasMayChange(change: { channel: ReviewChannel; mode: ReviewMode }): boolean {
  return change.mode === "hold";
}

export function parseReviewField(id: string, value: unknown): { channel: ReviewChannel; mode: ReviewMode } | null | undefined {
  if (!id.startsWith(FIELD_PREFIX)) return undefined;
  const channel = id.slice(FIELD_PREFIX.length);
  if (!isReviewChannel(channel) || !isReviewMode(value)) return null;
  return { channel, mode: value };
}
