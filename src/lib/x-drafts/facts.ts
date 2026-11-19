import { promises as fs } from "node:fs";
import { dataPath } from "@/lib/paths";
import { addDays } from "@/lib/x-drafts/schedule";

export const FACTS_FILE = "x-drafts-facts.json";
export const FACT_DAYS = 14;
const MAX_FACTS = 40;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type DatedFact = { date: string; text: string };

export function freshFacts(raw: unknown, today: string): DatedFact[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { facts?: unknown }).facts : null;
  if (!Array.isArray(list)) return [];
  const cutoff = addDays(today, -FACT_DAYS);
  return list
    .filter((entry): entry is DatedFact =>
      Boolean(entry) && typeof entry === "object" && typeof entry.date === "string" && DATE.test(entry.date) && typeof entry.text === "string" && entry.text.trim().length > 0)
    .filter((entry) => entry.date >= cutoff && entry.date <= today)
    .map((entry) => ({ date: entry.date, text: entry.text.replace(/\s+/g, " ").trim().slice(0, 300) }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_FACTS);
}

export async function readFacts(today: string): Promise<DatedFact[]> {
  try {
    return freshFacts(JSON.parse(await fs.readFile(dataPath(FACTS_FILE), "utf8")), today);
  } catch {
    return [];
  }
}
