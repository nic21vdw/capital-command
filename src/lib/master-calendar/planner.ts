import { aiConfigured, runAi } from "@/lib/ai";
import { addDaysToKey } from "@/lib/master-calendar/aggregate";
import type { MasterCalendarEvent } from "@/lib/master-calendar/types";
import type { VideoIdea } from "@/types/domain";

/**
 * AI calendar planner. Reads the aggregated Master Calendar for a window, spots
 * scheduling gaps against a simple cadence goal, and proposes concrete fills —
 * pulling from the creator's idea board when a fitting idea exists. This is the
 * first AI feature on the calendar; before it, the calendar only visualized
 * what was already scheduled.
 *
 * House AI pattern: *Configured() gate, pure schedule/prompt builders, tolerant
 * parser, and a rule-based heuristic fallback so a plan always comes back — even
 * with no AI provider reachable.
 */

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Cadence the planner aims for; also stated to the model. */
const GOAL_TEXT =
  "Cadence goal: at least one short-form clip (Shorts/Reels/TikTok) every weekday, a long-form video most weeks, and keep the Threads packs flowing. Weekends are optional.";

export type CalendarPlanKind = "short" | "longform" | "post";

export type CalendarPlanSuggestion = {
  /** Day to schedule on, YYYY-MM-DD. */
  dateKey: string;
  /** Short weekday label for display. */
  weekday: string;
  kind: CalendarPlanKind;
  title: string;
  reason: string;
  /** The idea-board idea this draws from, when one fit. */
  ideaId?: string;
};

export type CalendarPlan = {
  suggestions: CalendarPlanSuggestion[];
  summary: string;
  source: "ai" | "heuristic";
};

export function calendarPlannerConfigured(): boolean {
  return aiConfigured();
}

function weekdayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return WEEKDAY_LABELS[new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay()];
}

function isWeekend(dateKey: string): boolean {
  const label = weekdayLabel(dateKey);
  return label === "Sat" || label === "Sun";
}

/** Which calendar day-keys carry a scheduled short/reel/tiktok. */
function shortsDays(events: MasterCalendarEvent[]): Set<string> {
  return new Set(events.filter((event) => event.source === "shorts").map((event) => event.dateKey));
}

/** Renders the window's schedule as compact "date (Weekday): items" lines. Pure. */
export function summarizeSchedule(events: MasterCalendarEvent[], startKey: string, days: number): string {
  const byDay = new Map<string, string[]>();
  for (const event of events) {
    const label = `${event.source}${event.time ? ` @${event.time}` : ""}`;
    byDay.set(event.dateKey, [...(byDay.get(event.dateKey) ?? []), label]);
  }
  const lines: string[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const dateKey = addDaysToKey(startKey, offset);
    const items = byDay.get(dateKey);
    lines.push(`${dateKey} (${weekdayLabel(dateKey)}): ${items?.length ? items.join(", ") : "— nothing scheduled"}`);
  }
  return lines.join("\n");
}

/** Idea-board candidates the planner may draw from. Pure. */
export function availableIdeasText(ideas: VideoIdea[]): string {
  const usable = ideas.filter((idea) => idea.status === "suggested" || idea.status === "saved").slice(0, 40);
  if (usable.length === 0) return "(no ideas on the board — suggest fresh angles in the channel's voice)";
  return usable.map((idea) => `- [${idea.id}] (${idea.format}) ${idea.title}`).join("\n");
}

/** Builds the planning prompt. Pure, for tests. */
export function buildCalendarPlanPrompt(input: {
  events: MasterCalendarEvent[];
  ideas: VideoIdea[];
  startKey: string;
  days: number;
}): string {
  const { events, ideas, startKey, days } = input;
  return [
    `Here is my content calendar for the ${days}-day window starting ${startKey}:`,
    "",
    summarizeSchedule(events, startKey, days),
    "",
    GOAL_TEXT,
    "",
    "Ideas available on my board (draw from these when one fits; reference it by its [id]):",
    availableIdeasText(ideas),
    "",
    "Propose concrete fills for the GAPS only — days that fall short of the cadence goal. Do not suggest anything for a day that already meets the goal, and never schedule in the past relative to the window start.",
    "",
    'Return ONLY a JSON array (no prose): [{"dateKey":"YYYY-MM-DD","kind":"short"|"longform"|"post","title":"...","reason":"one sentence","ideaId":"<board id or omit>"}]. Keep titles in the channel voice — complete phrases, never transcript fragments.'
  ].join("\n");
}

type RawSuggestion = Record<string, unknown>;

/** Parses the plan, keeping only in-window suggestions. Pure, for tests. */
export function parseCalendarPlan(
  text: string,
  input: { startKey: string; days: number; ideaIds: Set<string> }
): CalendarPlanSuggestion[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  const endKey = addDaysToKey(input.startKey, input.days);
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    const out: CalendarPlanSuggestion[] = [];
    for (const raw of parsed as RawSuggestion[]) {
      const dateKey = typeof raw.dateKey === "string" ? raw.dateKey.trim() : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
      if (dateKey < input.startKey || dateKey >= endKey) continue;
      const title = typeof raw.title === "string" ? raw.title.trim() : "";
      if (!title) continue;
      const kind: CalendarPlanKind =
        raw.kind === "longform" ? "longform" : raw.kind === "post" ? "post" : "short";
      const ideaIdRaw = typeof raw.ideaId === "string" ? raw.ideaId.trim() : "";
      const ideaId = ideaIdRaw && input.ideaIds.has(ideaIdRaw) ? ideaIdRaw : undefined;
      out.push({
        dateKey,
        weekday: weekdayLabel(dateKey),
        kind,
        title: title.slice(0, 110),
        reason: typeof raw.reason === "string" ? raw.reason.trim() : "Fills a gap in the schedule.",
        ideaId
      });
    }
    return out.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  } catch {
    return [];
  }
}

/**
 * Rule-based fallback: every weekday in the window with no scheduled short is a
 * gap; fill each from the board (short-friendly ideas first), rotating through
 * the available ideas. Pure, for tests.
 */
export function heuristicPlan(input: {
  events: MasterCalendarEvent[];
  ideas: VideoIdea[];
  startKey: string;
  days: number;
}): CalendarPlan {
  const { events, ideas, startKey, days } = input;
  const covered = shortsDays(events);
  const pool = ideas
    .filter((idea) => idea.status === "suggested" || idea.status === "saved")
    .filter((idea) => idea.format === "short" || idea.format === "both" || idea.format === "longform");
  const suggestions: CalendarPlanSuggestion[] = [];
  let poolIndex = 0;
  for (let offset = 0; offset < days; offset += 1) {
    const dateKey = addDaysToKey(startKey, offset);
    if (isWeekend(dateKey) || covered.has(dateKey)) continue;
    const idea = pool[poolIndex];
    poolIndex += 1;
    suggestions.push({
      dateKey,
      weekday: weekdayLabel(dateKey),
      kind: "short",
      title: idea ? idea.title : "New short — pick a moment from your best recent stream",
      reason: idea
        ? "No short is scheduled this weekday — fill it from your idea board."
        : "No short is scheduled this weekday and the idea board is empty — generate ideas first.",
      ideaId: idea?.id
    });
  }
  const summary =
    suggestions.length === 0
      ? "Every weekday in this window already has a short scheduled — you're on cadence."
      : `${suggestions.length} weekday${suggestions.length === 1 ? "" : "s"} in this window have no short scheduled.`;
  return { suggestions, summary, source: "heuristic" };
}

/**
 * Produces a plan for the window. Uses the AI provider when configured and its
 * reply is usable; otherwise (or on any failure) returns the heuristic plan.
 * Never throws.
 */
export async function generateCalendarPlan(input: {
  events: MasterCalendarEvent[];
  ideas: VideoIdea[];
  startKey: string;
  days: number;
}): Promise<CalendarPlan> {
  const fallback = heuristicPlan(input);
  if (!calendarPlannerConfigured()) return fallback;
  try {
    const result = await runAi({
      maxTokens: 2000,
      system:
        "You are a content-calendar strategist for a solo creator who ships AI/coding videos. You plan realistic, gap-filling schedules and never invent results or numbers. You always return strict JSON.",
      messages: [{ role: "user", content: buildCalendarPlanPrompt(input) }]
    });
    if (!result || result.refused) return fallback;
    const ideaIds = new Set(input.ideas.map((idea) => idea.id));
    const suggestions = parseCalendarPlan(result.text, { startKey: input.startKey, days: input.days, ideaIds });
    if (suggestions.length === 0) return fallback;
    const summary = `${suggestions.length} gap-fill suggestion${suggestions.length === 1 ? "" : "s"} for this window.`;
    return { suggestions, summary, source: "ai" };
  } catch {
    return fallback;
  }
}
