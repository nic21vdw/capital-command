import { promises as fs } from "node:fs";
import { dataPath } from "@/lib/paths";
import { addDays } from "@/lib/x-drafts/schedule";

export const FACTS_FILE = "x-drafts-facts.json";
export const FACT_DAYS = 14;
const MAX_FACTS = 40;
const MAX_PER_TOPIC = 6;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const FACT_TOPICS = ["stream", "channel", "colateral", "arcade", "videos"] as const;
export type FactTopic = (typeof FACT_TOPICS)[number];

export type DatedFact = { date: string; text: string; topic?: FactTopic };

function topicOf(value: unknown): FactTopic | undefined {
  return typeof value === "string" && (FACT_TOPICS as readonly string[]).includes(value) ? (value as FactTopic) : undefined;
}

export function freshFacts(raw: unknown, today: string): DatedFact[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { facts?: unknown }).facts : null;
  if (!Array.isArray(list)) return [];
  const cutoff = addDays(today, -FACT_DAYS);
  return list
    .filter((entry): entry is DatedFact =>
      Boolean(entry) && typeof entry === "object" && typeof entry.date === "string" && DATE.test(entry.date) && typeof entry.text === "string" && entry.text.trim().length > 0)
    .filter((entry) => entry.date >= cutoff && entry.date <= today)
    .map((entry) => {
      const topic = topicOf(entry.topic);
      return { date: entry.date, text: entry.text.replace(/\s+/g, " ").trim().slice(0, 300), ...(topic ? { topic } : {}) };
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_FACTS);
}

export function mergeFacts(manual: DatedFact[], live: DatedFact[]): DatedFact[] {
  const seen = new Set<string>();
  const perTopic = new Map<string, number>();
  const merged: DatedFact[] = [];
  for (const fact of [...manual, ...live]) {
    const key = fact.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) continue;
    const topic = fact.topic ?? "";
    const count = perTopic.get(topic) ?? 0;
    if (topic && count >= MAX_PER_TOPIC) continue;
    seen.add(key);
    perTopic.set(topic, count + 1);
    merged.push(fact);
  }
  return merged.sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_FACTS);
}

export function factTopics(facts: DatedFact[]): FactTopic[] {
  return FACT_TOPICS.filter((topic) => facts.some((fact) => fact.topic === topic));
}

export async function readFacts(today: string): Promise<DatedFact[]> {
  try {
    return freshFacts(JSON.parse(await fs.readFile(dataPath(FACTS_FILE), "utf8")), today);
  } catch {
    return [];
  }
}
