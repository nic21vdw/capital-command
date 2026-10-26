import type { SurfaceControl, SurfaceField, SurfaceReading } from "@/lib/colateral/protocol";
import { refuse, type SurfaceRefusal } from "@/lib/colateral/surface";
import { instantLabel } from "@/components/uploading-center/schedule-summary";
import { resolvePublishAt } from "@/lib/publisher/time";
import { ALL_PLATFORMS, type PlatformId } from "@/lib/publisher/types";

export const BOOK_GROUP = "Book clip";

export const BOOK_PLATFORMS: PlatformId[] = [...ALL_PLATFORMS];

const PLATFORM_NAMES: Record<PlatformId, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook"
};

const BOOK_HINT =
  "Schedules the chosen clip on the chosen platform at the chosen time, through the same booking the calendar uses. It goes live then.";

export interface BookableClip {
  key: string;
  headline: string;
}

export interface BookDraft {
  clipKey: string;
  platform: PlatformId | "";
  at: string;
  caption: string;
}

export const EMPTY_BOOK_DRAFT: BookDraft = { clipKey: "", platform: "", at: "", caption: "" };

export interface BookingRecord {
  phase: "idle" | "booking" | "booked" | "refused";
  text: string;
}

export const IDLE_BOOKING: BookingRecord = { phase: "idle", text: "" };

export interface ScheduleOutcome {
  ok: boolean;
  message: string;
}

export interface BookOverride {
  platform: PlatformId;
  slotUtc: string;
  caption?: string;
}

export type BookScheduler<C> = (
  clip: C,
  override: BookOverride,
  hooks: { onOutcome: (outcome: ScheduleOutcome) => void }
) => Promise<boolean>;

export interface BookingContext<C extends BookableClip> {
  clips: C[];
  timezone: string;
  now: Date;
  publishingOn: boolean;
  loaded: boolean;
  busy: string | null;
}

export function clipChoices(clips: BookableClip[]): { key: string; label: string }[] {
  const seen = new Map<string, number>();
  return clips.map((clip) => {
    const base = clip.headline.trim() || "Untitled clip";
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { key: clip.key, label: count === 1 ? base : `${base} (${count})` };
  });
}

function findChoice(clips: BookableClip[], name: string): { key: string; label: string } | undefined {
  const wanted = name.trim().toLowerCase();
  const choices = clipChoices(clips);
  return choices.find((choice) => choice.key === name.trim()) ?? choices.find((choice) => choice.label.toLowerCase() === wanted);
}

export function bookFields(draft: BookDraft, clips: BookableClip[], timezone: string): SurfaceField[] {
  const choices = clipChoices(clips);
  return [
    {
      id: "bookClip",
      label: "Clip to book",
      value: choices.find((choice) => choice.key === draft.clipKey)?.label ?? "",
      kind: "select",
      options: choices.map((choice) => choice.label),
      hint: "A finished clip from the run shown on this page."
    },
    {
      id: "bookPlatform",
      label: "Platform to book on",
      value: draft.platform,
      kind: "select",
      options: [...BOOK_PLATFORMS],
      hint: "One platform per booking. Instagram books Instagram and Facebook together."
    },
    {
      id: "bookAt",
      label: "Post at",
      value: draft.at,
      kind: "text",
      hint: `Local time in ${timezone} as YYYY-MM-DDTHH:mm, or ISO-8601 with an offset. The earliest day is tomorrow.`
    },
    {
      id: "bookCaption",
      label: "Caption for this booking",
      value: draft.caption,
      kind: "longtext",
      hint: "Leave empty to have one written when it books."
    }
  ];
}

export function applyBookField(
  draft: BookDraft,
  id: string,
  value: string | number | boolean | null,
  context: { clips: BookableClip[]; timezone: string }
): { draft: BookDraft } | SurfaceRefusal | null {
  if (id === "bookClip") {
    const choice = typeof value === "string" ? findChoice(context.clips, value) : undefined;
    if (!choice) {
      const available = clipChoices(context.clips)
        .slice(0, 10)
        .map((entry) => entry.label)
        .join(", ");
      return refuse(`No clip called "${String(value)}" in this run.${available ? ` Pick one of: ${available}.` : ""}`);
    }
    return { draft: { ...draft, clipKey: choice.key } };
  }
  if (id === "bookPlatform") {
    const platform = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!BOOK_PLATFORMS.includes(platform as PlatformId)) {
      return refuse(`"${String(value)}" is not a platform to book on. Use one of: ${BOOK_PLATFORMS.join(", ")}.`);
    }
    return { draft: { ...draft, platform: platform as PlatformId } };
  }
  if (id === "bookAt") {
    if (typeof value !== "string") return refuse("The time must be text such as 2026-10-16T18:00.");
    const text = value.trim();
    if (text) {
      try {
        resolvePublishAt(text, context.timezone);
      } catch (error) {
        return refuse(error instanceof Error ? error.message : String(error));
      }
    }
    return { draft: { ...draft, at: text } };
  }
  if (id === "bookCaption") {
    if (value !== null && typeof value !== "string") return refuse("The caption must be text.");
    return { draft: { ...draft, caption: value ?? "" } };
  }
  return null;
}

function blocker(context: BookingContext<BookableClip>): string | null {
  if (!context.loaded) return "The schedule is still loading.";
  if (!context.publishingOn) return "Posting is off - turn it on in Settings to book clips.";
  if (context.clips.length === 0) return "There are no finished clips in this run to book.";
  if (context.busy) return "Another booking is in progress.";
  return null;
}

export function bookControl(context: BookingContext<BookableClip>): SurfaceControl {
  const reason = blocker(context);
  return {
    id: "book",
    label: "Book",
    group: BOOK_GROUP,
    destructive: true,
    disabled: reason !== null,
    hint: reason ?? BOOK_HINT
  };
}

interface BookPlan<C> {
  clip: C;
  override: BookOverride;
  summary: string;
}

function planBooking<C extends BookableClip>(
  draft: BookDraft,
  context: BookingContext<C>
): { ok: true; plan: BookPlan<C> } | { ok: false; reason: string } {
  const blocked = blocker(context);
  if (blocked) return { ok: false, reason: blocked };
  if (!draft.clipKey) return { ok: false, reason: 'Choose a clip first: set the "Clip to book" field.' };
  const clip = context.clips.find((candidate) => candidate.key === draft.clipKey);
  if (!clip) return { ok: false, reason: "That clip is no longer in this run. Choose another." };
  if (!draft.platform) return { ok: false, reason: 'Choose a platform first: set the "Platform to book on" field.' };
  if (!draft.at.trim()) return { ok: false, reason: 'Set the time first: fill in the "Post at" field.' };
  let instant: Date;
  try {
    instant = resolvePublishAt(draft.at, context.timezone);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const when = instantLabel(instant, context.timezone);
  if (instant.getTime() <= context.now.getTime()) return { ok: false, reason: `That time has already passed (${when}).` };
  const caption = draft.caption.trim();
  const label = clipChoices(context.clips).find((choice) => choice.key === clip.key)?.label ?? clip.headline;
  return {
    ok: true,
    plan: {
      clip,
      override: { platform: draft.platform, slotUtc: instant.toISOString(), ...(caption ? { caption } : {}) },
      summary: `"${label}" on ${PLATFORM_NAMES[draft.platform]} at ${when}`
    }
  };
}

async function runBooking<C extends BookableClip>(
  plan: BookPlan<C>,
  schedule: BookScheduler<C>,
  report: (record: BookingRecord) => void
): Promise<boolean> {
  report({ phase: "booking", text: `${plan.summary}.` });
  const seen: { outcome?: ScheduleOutcome } = {};
  let returned = false;
  try {
    returned = await schedule(plan.clip, plan.override, {
      onOutcome: (outcome) => {
        seen.outcome = outcome;
      }
    });
  } catch (error) {
    seen.outcome = { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  const booked = returned && (seen.outcome?.ok ?? true);
  const message =
    seen.outcome?.message.trim() || (booked ? "Scheduled." : "The booking was refused; the Uploading Center shows why.");
  report({ phase: booked ? "booked" : "refused", text: `${plan.summary}. ${message}` });
  return booked;
}

export function startBooking<C extends BookableClip>(
  draft: BookDraft,
  context: BookingContext<C>,
  schedule: BookScheduler<C>,
  report: (record: BookingRecord) => void
): { ok: true; done: Promise<boolean> } | { ok: false; reason: string } {
  const planned = planBooking(draft, context);
  if (!planned.ok) return planned;
  return { ok: true, done: runBooking(planned.plan, schedule, report) };
}

const PHASE_LABEL: Record<Exclude<BookingRecord["phase"], "idle">, string> = {
  booking: "In progress",
  booked: "Booked",
  refused: "Refused"
};

export function bookingReading(record: BookingRecord): SurfaceReading {
  if (record.phase === "idle") return { label: "Last booking", value: "None yet this session." };
  return { label: "Last booking", value: `${PHASE_LABEL[record.phase]}: ${record.text}` };
}
