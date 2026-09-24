import { contentTokens, jaccard } from "@/lib/story/units";
import type { Moment, OpenLoop, SectionRole, StoryPlan, StorySection, Unit } from "@/lib/story/types";

export const TARGET_MIN_SEC = 8 * 60;
export const TARGET_MAX_SEC = 12 * 60;
export const TARGET_AIM_SEC = 10 * 60;
export const HOOK_MAX_SEC = 30;
export const MIN_OPEN_LOOPS = 2;

export const SECTION_ORDER: SectionRole[] = ["hook", "setup", "development", "payoff", "close"];

const MOMENT_GAP_SEC = 3;
const TRIM_BIAS: Partial<Record<SectionRole, number>> = { development: 0, setup: 0.02, close: 0.03, payoff: 0.06 };
const MOMENT_MAX_SEC = 150;

export function buildMoments(units: Unit[]): Moment[] {
  const moments: Moment[] = [];
  let current: Unit[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const duration = current.reduce((sum, unit) => sum + (unit.end - unit.start), 0);
    const score = current.reduce((sum, unit) => sum + unit.scores.combined * (unit.end - unit.start), 0) / Math.max(0.1, duration);
    moments.push({
      id: `m${String(moments.length + 1).padStart(3, "0")}`,
      unitIds: current.map((unit) => unit.id),
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current.map((unit) => unit.text).join(" "),
      score: Math.round(score * 1000) / 1000
    });
    current = [];
  };
  for (const unit of units) {
    const last = current[current.length - 1];
    if (last && (unit.start - last.end > MOMENT_GAP_SEC || unit.end - current[0].start > MOMENT_MAX_SEC)) flush();
    current.push(unit);
  }
  flush();
  return moments;
}

export function locateQuote(quote: string, units: Unit[], maxSec = HOOK_MAX_SEC): string[] {
  const target = contentTokens(quote);
  if (units.length === 0) return [];
  let best: { ids: string[]; score: number } = { ids: [units[0].id], score: -1 };
  for (let i = 0; i < units.length; i++) {
    for (let j = i; j < units.length && units[j].end - units[i].start <= maxSec; j++) {
      const span = units.slice(i, j + 1);
      const tokens = contentTokens(span.map((unit) => unit.text).join(" "));
      const score = jaccard(target, tokens) - (j - i) * 0.01;
      if (score > best.score) best = { ids: span.map((unit) => unit.id), score };
    }
  }
  return best.ids;
}

export function pickHeuristicHook(units: Unit[]): { ids: string[]; reason: string } {
  const candidates = units.filter((unit) => !unit.retakeOf && unit.end - unit.start >= 5 && unit.end - unit.start <= HOOK_MAX_SEC);
  const pool = candidates.length ? candidates : units;
  const best = [...pool].sort(
    (a, b) => b.scores.story * 0.5 + b.scores.combined * 0.5 - (a.scores.story * 0.5 + a.scores.combined * 0.5)
  )[0];
  return {
    ids: best ? [best.id] : [],
    reason: best
      ? `Strongest single line in the footage (story ${best.scores.story}, combined ${best.scores.combined}) at ${formatClock(best.start)} of the source: ${best.reason}.`
      : "No speech to open on."
  };
}

export type RuntimeOf = (momentId: string) => number;

export function planRuntime(plan: StoryPlan, runtimeOf: RuntimeOf, hookSec: number): number {
  return hookSec + plan.sections.flatMap((section) => section.momentIds).reduce((sum, id) => sum + runtimeOf(id), 0);
}

export function protectedMoments(plan: StoryPlan, unitMoment: Map<string, string>): Set<string> {
  const ids = new Set<string>();
  for (const loop of plan.openLoops) {
    const plant = unitMoment.get(loop.plantUnitId);
    const payoff = unitMoment.get(loop.payoffUnitId);
    if (plant) ids.add(plant);
    if (payoff) ids.add(payoff);
  }
  return ids;
}

export function fitRuntime(input: {
  plan: StoryPlan;
  moments: Moment[];
  runtimeOf: RuntimeOf;
  hookSec: number;
  unitMoment: Map<string, string>;
  minMomentScore: number;
}): StoryPlan {
  const { moments, runtimeOf, hookSec, unitMoment, minMomentScore } = input;
  const plan: StoryPlan = { ...input.plan, sections: input.plan.sections.map((section) => ({ ...section, momentIds: [...section.momentIds] })) };
  const byId = new Map(moments.map((moment) => [moment.id, moment]));
  const keep = protectedMoments(plan, unitMoment);
  const used = () => new Set(plan.sections.flatMap((section) => section.momentIds));

  const weight = (section: StorySection, id: string) => (byId.get(id)?.score ?? 0) + (TRIM_BIAS[section.role] ?? 0);
  while (planRuntime(plan, runtimeOf, hookSec) > TARGET_AIM_SEC + 60) {
    const candidates = plan.sections
      .flatMap((section) => section.momentIds.map((id) => ({ section, id })))
      .filter(({ section }) => section.momentIds.length > 1)
      .sort((a, b) => weight(a.section, a.id) - weight(b.section, b.id));
    const victim = candidates.find(({ id }) => !keep.has(id)) ?? (planRuntime(plan, runtimeOf, hookSec) > TARGET_MAX_SEC ? candidates[0] : undefined);
    if (!victim) break;
    victim.section.momentIds = victim.section.momentIds.filter((id) => id !== victim.id);
  }
  plan.openLoops = plan.openLoops.filter((loop) => {
    const taken = used();
    return [loop.plantUnitId, loop.payoffUnitId].every((unitId) => !unitMoment.has(unitId) || taken.has(unitMoment.get(unitId)!));
  });

  const developments = plan.sections.filter((section) => section.role === "development");
  if (developments.length === 0) {
    const insertAt = Math.max(0, plan.sections.findIndex((section) => section.role === "payoff"));
    const fresh: StorySection = { role: "development", title: "The build", momentIds: [], reason: "Filled from the strongest remaining moments." };
    plan.sections.splice(insertAt === -1 ? plan.sections.length : insertAt, 0, fresh);
    developments.push(fresh);
  }

  const aim = TARGET_AIM_SEC - 30;
  while (planRuntime(plan, runtimeOf, hookSec) < aim) {
    const taken = used();
    const current = planRuntime(plan, runtimeOf, hookSec);
    const next = moments
      .filter((moment) => !taken.has(moment.id) && moment.score >= minMomentScore)
      .filter((moment) => current + runtimeOf(moment.id) <= TARGET_MAX_SEC)
      .sort((a, b) => b.score - a.score)[0];
    if (!next) break;
    const home = developments.reduce((closest, section) => {
      const distance = (s: StorySection) =>
        Math.min(...s.momentIds.map((id) => Math.abs((byId.get(id)?.start ?? 0) - next.start)), Infinity);
      return distance(section) < distance(closest) ? section : closest;
    }, developments[0]);
    home.momentIds = [...home.momentIds, next.id].sort((a, b) => (byId.get(a)?.start ?? 0) - (byId.get(b)?.start ?? 0));
  }

  const runtime = planRuntime(plan, runtimeOf, hookSec);
  if (runtime < TARGET_MIN_SEC) {
    plan.shortfall = `The footage only has ${formatClock(runtime)} of material that scores above ${minMomentScore} after cleanup, short of the 8:00 floor. Padding it with weaker moments would make a worse video, so it is left at this length.`;
  } else delete plan.shortfall;
  return plan;
}

export function orderedUnitIds(plan: StoryPlan, moments: Moment[], units: Map<string, Unit>, disabled: Set<string>): string[] {
  const byId = new Map(moments.map((moment) => [moment.id, moment]));
  const order: string[] = [...plan.hookUnitIds];
  for (const role of SECTION_ORDER) {
    for (const section of plan.sections.filter((entry) => entry.role === role)) {
      for (const momentId of section.momentIds) {
        for (const unitId of byId.get(momentId)?.unitIds ?? []) {
          const unit = units.get(unitId);
          if (!unit || unit.retakeOf || disabled.has(unitId)) continue;
          order.push(unitId);
        }
      }
    }
  }
  return order;
}

export function validLoops(loops: OpenLoop[], order: string[]): OpenLoop[] {
  const position = new Map(order.map((id, index) => [id, index]));
  return loops.filter((loop) => {
    const plant = position.get(loop.plantUnitId);
    const payoff = position.get(loop.payoffUnitId);
    return plant !== undefined && payoff !== undefined && plant < payoff;
  });
}

export function heuristicLoops(order: string[], units: Map<string, Unit>): OpenLoop[] {
  const loops: OpenLoop[] = [];
  const firstThird = Math.max(1, Math.floor(order.length / 3));
  for (let i = 0; i < firstThird && loops.length < 3; i++) {
    const plant = units.get(order[i]);
    if (!plant || !/\?|going to|gonna|let's see|we'll see|find out|will it|can i|if this works/i.test(plant.text)) continue;
    const plantTokens = contentTokens(plant.text);
    let best: { id: string; score: number } | null = null;
    for (let j = Math.max(i + 1, firstThird); j < order.length; j++) {
      const candidate = units.get(order[j]);
      if (!candidate) continue;
      const score = jaccard(plantTokens, contentTokens(candidate.text));
      if (score > 0.15 && (!best || score > best.score)) best = { id: candidate.id, score };
    }
    if (best) loops.push({ plantUnitId: plant.id, payoffUnitId: best.id, question: plant.text.slice(0, 120) });
  }
  return loops;
}

export function heuristicPlan(moments: Moment[], units: Unit[], targetSec = TARGET_AIM_SEC): StoryPlan {
  const hook = pickHeuristicHook(units);
  const ranked = [...moments].sort((a, b) => b.score - a.score).slice(0, 14);
  const chronological = ranked.sort((a, b) => a.start - b.start);
  const best = [...chronological].sort((a, b) => b.score - a.score)[0];
  const rest = chronological.filter((moment) => moment.id !== best?.id);
  const setup = rest.slice(0, 1);
  const close = rest.length > 2 ? rest.slice(-1) : [];
  const development = rest.filter((moment) => !setup.includes(moment) && !close.includes(moment));
  const sections: StorySection[] = [
    { role: "setup" as const, title: "Where it starts", momentIds: setup.map((m) => m.id), reason: "Earliest strong moment sets up the day." },
    { role: "development" as const, title: "The build", momentIds: development.map((m) => m.id), reason: "Highest-scoring moments in the order they happened." },
    ...(best ? [{ role: "payoff" as const, title: "The payoff", momentIds: [best.id], reason: "Highest combined score in the stream." }] : []),
    ...(close.length ? [{ role: "close" as const, title: "Wrapping up", momentIds: close.map((m) => m.id), reason: "Latest selected moment closes the video." }] : [])
  ].filter((section) => section.momentIds.length > 0);
  return { hookUnitIds: hook.ids, hookReason: hook.reason, sections, openLoops: [], source: "heuristic", targetSec };
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, "0")}` : `${mm}:${String(s).padStart(2, "0")}`;
}
