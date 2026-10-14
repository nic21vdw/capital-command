import { z } from "zod";
import { addDays, daysBetween } from "@/lib/execution/dates";

/**
 * Outreach — a tracker for the creators, newsletters and podcasts worth
 * offering CoLateral to. It is a list and a set of readings, nothing more: the
 * app never sends an email or a DM. Writing to a person stays a human act.
 *
 * Pure: no fs, no fetch. The store (store.ts) persists it to
 * data/outreach.json; the page, the API and the import CLI all share these
 * helpers so "due for follow-up" means the same thing everywhere.
 */

export const OUTREACH_PLATFORMS = ["youtube", "x", "newsletter", "podcast", "other"] as const;
export type OutreachPlatform = (typeof OUTREACH_PLATFORMS)[number];

export const OUTREACH_KINDS = ["creator", "thread"] as const;
export type OutreachKind = (typeof OUTREACH_KINDS)[number];

export const OUTREACH_STATUSES = ["to-contact", "contacted", "replied", "deal", "declined", "not-a-fit"] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

/** Finished conversations — nothing is ever "due" on one of these. */
export const CLOSED_STATUSES: ReadonlySet<OutreachStatus> = new Set(["deal", "declined", "not-a-fit"]);

/** A healthy week of outreach: fewer is a stall, more is spray. */
export const WEEKLY_TARGET = { min: 5, max: 10 } as const;

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const outreachContactSchema = z.object({
  id: z.string().min(1),
  /** The channel, newsletter or show name. */
  name: z.string().min(1),
  url: z.string().min(1),
  platform: z.enum(OUTREACH_PLATFORMS).default("youtube"),
  kind: z.enum(OUTREACH_KINDS).default("creator"),
  topic: z.string().default(""),
  approxAudience: z.string().default(""),
  recentVideo: z.object({ title: z.string().default(""), url: z.string().default("") }).optional(),
  /** Why they are a fit. */
  fit: z.string().default(""),
  /** The angle to open with. */
  angle: z.string().default(""),
  status: z.enum(OUTREACH_STATUSES).default("to-contact"),
  affiliateCode: z.string().optional(),
  licenceSent: z.boolean().default(false),
  lastContactedAt: localDate.optional(),
  nextFollowUpAt: localDate.optional(),
  notes: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type OutreachContact = z.infer<typeof outreachContactSchema>;

export const DEFAULT_OUTREACH_TEMPLATE = `Hi {name},

I just watched {video} and wanted to say it was genuinely useful.

I'm Nic, and I build CoLateral, the all-in-one agentic workspace: you run Claude Code, Codex and Gemini side by side on one canvas, bring your own AI subscriptions, and pay once.

If it looks like a fit for your audience, I'd be happy to send you a free licence to try. No obligation to cover it, and if you ever did want to, I can set you up with an affiliate code.

Either way, thanks for the video.
Nic`;

export const DEFAULT_THREAD_TEMPLATE = `Hi,

I came across {thread} and wanted to help with what you were asking.

[Answer their question here, in a sentence or two, before anything about CoLateral.]

Full disclosure: I'm Nic and I build CoLateral, the all-in-one agentic workspace: one desktop canvas where your Claude Code, Codex and Gemini agents work side by side, inside your real files. If that sounds like what you're after, it's a one-time licence and you bring your own AI subscriptions. If it isn't, no worries, I hope the above helps.

Nic`;

export const outreachStoreSchema = z.object({
  contacts: z.array(outreachContactSchema).default([]),
  template: z.string().default(DEFAULT_OUTREACH_TEMPLATE),
  threadTemplate: z.string().default(DEFAULT_THREAD_TEMPLATE)
});
export type OutreachStore = z.infer<typeof outreachStoreSchema>;

export const defaultOutreachStore: OutreachStore = { contacts: [], template: DEFAULT_OUTREACH_TEMPLATE, threadTemplate: DEFAULT_THREAD_TEMPLATE };

export function templateFor(store: Pick<OutreachStore, "template" | "threadTemplate">, contact: Pick<OutreachContact, "kind">): string {
  return contact.kind === "thread" ? store.threadTemplate : store.template;
}

/**
 * What an import file or the add form may supply. Everything but name and url
 * is optional; ids and timestamps are the store's to assign.
 */
export const outreachContactInputSchema = outreachContactSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .partial()
  .extend({ name: z.string().trim().min(1), url: z.string().trim().min(1), id: z.string().optional() });
export type OutreachContactInput = z.input<typeof outreachContactInputSchema>;

/**
 * The dedupe key. "https://www.YouTube.com/@foo/" and "youtube.com/@foo" are
 * the same channel, so case, protocol, a leading www and a trailing slash do
 * not count; the path and query do.
 */
export function normalizeContactUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/#.*$/, "")
    .replace(/\/+$/, "");
}

function newId(): string {
  return `contact-${globalThis.crypto.randomUUID()}`;
}

export interface MergeResult {
  contacts: OutreachContact[];
  added: number;
  updated: number;
  skipped: { index: number; reason: string }[];
}

/**
 * Merge incoming contacts into the list, deduped by url. A url already on the
 * list is updated with whatever the import actually supplied — a field the
 * import leaves out keeps what is stored, so re-importing a research file can
 * never wipe out a status or notes Nic wrote by hand. Invalid rows are reported,
 * never silently dropped.
 */
export function mergeContacts(existing: OutreachContact[], incoming: unknown[], now = new Date().toISOString()): MergeResult {
  const contacts = [...existing];
  const byUrl = new Map(contacts.map((contact, index) => [normalizeContactUrl(contact.url), index]));
  let added = 0;
  let updated = 0;
  const skipped: MergeResult["skipped"] = [];

  incoming.forEach((raw, index) => {
    const parsed = outreachContactInputSchema.safeParse(raw);
    if (!parsed.success) {
      skipped.push({ index, reason: parsed.error.issues.map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`).join("; ") });
      return;
    }
    const { id: _ignored, ...input } = parsed.data;
    void _ignored;
    const key = normalizeContactUrl(input.url);
    const at = byUrl.get(key);
    if (at !== undefined) {
      const supplied = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
      contacts[at] = outreachContactSchema.parse({ ...contacts[at], ...supplied, url: contacts[at].url, updatedAt: now });
      updated += 1;
      return;
    }
    const contact = outreachContactSchema.parse({ ...input, id: newId(), createdAt: now, updatedAt: now });
    byUrl.set(key, contacts.length);
    contacts.push(contact);
    added += 1;
  });

  return { contacts, added, updated, skipped };
}

/** Contacts whose follow-up date has arrived and whose conversation is still open, oldest first. */
export function dueForFollowUp(contacts: OutreachContact[], today: string): OutreachContact[] {
  return contacts
    .filter((contact) => !CLOSED_STATUSES.has(contact.status) && contact.nextFollowUpAt && contact.nextFollowUpAt <= today)
    .sort((a, b) => (a.nextFollowUpAt ?? "").localeCompare(b.nextFollowUpAt ?? ""));
}

export interface WeeklyPace {
  /** Contacts first or last reached in the seven days ending today. */
  contacted: number;
  min: number;
  max: number;
  state: "behind" | "on-pace" | "over";
}

/** How many people were contacted in the last seven days (today included) against the 5-10 target. */
export function weeklyPace(contacts: OutreachContact[], today: string): WeeklyPace {
  const contacted = contacts.filter((contact) => {
    if (!contact.lastContactedAt) return false;
    const age = daysBetween(contact.lastContactedAt, today);
    return age >= 0 && age < 7;
  }).length;
  const state = contacted < WEEKLY_TARGET.min ? "behind" : contacted > WEEKLY_TARGET.max ? "over" : "on-pace";
  return { contacted, min: WEEKLY_TARGET.min, max: WEEKLY_TARGET.max, state };
}

export function paceLabel(pace: WeeklyPace): string {
  const verdict = pace.state === "behind" ? "behind" : pace.state === "over" ? "over target" : "on pace";
  return `${pace.contacted} contacted in the last 7 days (target ${pace.min}-${pace.max}, ${verdict})`;
}

/**
 * Fill {name} and {video} in the outreach template. A contact with no recent
 * video gets "your recent video" rather than a literal "{video}", so a copied
 * message never ships with a placeholder in it.
 */
export function renderOutreachTemplate(
  template: string,
  contact: Pick<OutreachContact, "name" | "recentVideo"> & { topic?: string }
): string {
  const video = contact.recentVideo?.title?.trim() ? `"${contact.recentVideo.title.trim()}"` : "your recent video";
  const thread = contact.topic?.trim() ? `"${contact.topic.trim()}"` : "your post";
  return template
    .replaceAll("{name}", contact.name.trim() || "there")
    .replaceAll("{video}", video)
    .replaceAll("{thread}", thread);
}

export function countByStatus(contacts: OutreachContact[]): Record<OutreachStatus, number> {
  const counts = Object.fromEntries(OUTREACH_STATUSES.map((status) => [status, 0])) as Record<OutreachStatus, number>;
  for (const contact of contacts) counts[contact.status] += 1;
  return counts;
}

/**
 * Moving a contact to a status is also the moment its dates change: marking
 * someone contacted stamps today and books a follow-up a week out (unless one
 * is already booked later), and closing a conversation clears the follow-up so
 * it can never come back as due.
 */
export function applyStatus(contact: OutreachContact, status: OutreachStatus, today: string, now = new Date().toISOString()): OutreachContact {
  const next: OutreachContact = { ...contact, status, updatedAt: now };
  if (status === "contacted" && contact.status !== "contacted") {
    next.lastContactedAt = today;
    if (!contact.nextFollowUpAt || contact.nextFollowUpAt <= today) next.nextFollowUpAt = addDays(today, 7);
  }
  if (CLOSED_STATUSES.has(status)) next.nextFollowUpAt = undefined;
  return next;
}

