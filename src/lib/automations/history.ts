import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dataPath } from "@/lib/paths";
import { AUTOMATION_EVENT_KINDS, AUTOMATION_IDS, type AutomationEventKind, type AutomationHistory, type AutomationHistoryEvent, type AutomationId } from "@/lib/automations/types";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_EVENTS = 50_000;
const PAGE_SIZE = 50;
const journalName = /^(pipeline|ingest|publisher|threads|podcast)-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const schema = z.object({
  id: z.string().min(1).max(80), at: z.string().datetime(), automationId: z.enum(AUTOMATION_IDS),
  scope: z.enum(["worker", "delivery", "control"]), kind: z.enum(AUTOMATION_EVENT_KINDS), detail: z.string().max(1000),
  itemId: z.string().max(100).optional(), destination: z.string().max(100).optional(), nextAttemptAt: z.string().datetime().optional()
});
let lastPruned = 0;

export function historyDetail(value: string): string {
  return value.replace(/\u2014/g, " - ")
    .replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [hidden]")
    .replace(/([?&](?:access_token|refresh_token|token|secret|key|api_key)=)[^\s&"']+/gi, "$1[hidden]")
    .replace(/("(?:access_token|refresh_token|client_secret|accessToken|refreshToken|apiKey)"\s*:\s*")[^"]*/gi, "$1[hidden]")
    .replace(/((?:access_token|refresh_token|client_secret|api_key|authorization)\s*[=:]\s*)[^\s,;]+/gi, "$1[hidden]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[hidden]@")
    .slice(0, 1000);
}

async function prune(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - WEEK_MS).toISOString().slice(0, 10);
  const folder = dataPath("automations", "history");
  for (const name of await readdir(folder)) {
    const match = journalName.exec(name);
    if (match && match[2] < cutoff) await unlink(path.join(folder, name)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}

export async function recordAutomationEvent(input: Omit<AutomationHistoryEvent, "id"> & { key?: string }, now = new Date()): Promise<void> {
  const { key, ...fields } = input;
  const event = schema.parse({ ...fields, detail: historyDetail(input.detail), id: key ? createHash("sha256").update(`${input.automationId}:${input.scope}:${input.kind}:${key}`).digest("hex") : randomUUID() });
  const folder = dataPath("automations", "history");
  await mkdir(folder, { recursive: true });
  await appendFile(path.join(folder, `${event.automationId}-${event.at.slice(0, 10)}.jsonl`), `${JSON.stringify(event)}\n`, "utf8");
  if (now.getTime() - lastPruned > 60_000) {
    lastPruned = now.getTime();
    await prune(now);
  }
}

export async function recordAutomationEventSafely(input: Parameters<typeof recordAutomationEvent>[0]): Promise<void> {
  try {
    await recordAutomationEvent(input);
  } catch {
    console.warn("[automations] History could not be saved. The worker action was not interrupted.");
  }
}

export type HistoryQuery = { automationId?: AutomationId; kind?: AutomationEventKind | "activity"; page?: number };

export async function readAutomationHistory(query: HistoryQuery = {}, now = new Date()): Promise<AutomationHistory> {
  const from = new Date(now.getTime() - WEEK_MS).toISOString();
  const to = now.toISOString();
  const folder = dataPath("automations", "history");
  const warnings = new Set<string>();
  const records = new Map<string, AutomationHistoryEvent>();
  let names: string[];
  try { names = await readdir(folder); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    names = [];
  }
  for (const name of names.sort().reverse()) {
    const match = journalName.exec(name);
    if (!match || match[2] < from.slice(0, 10) || match[2] > to.slice(0, 10) || (query.automationId && match[1] !== query.automationId)) continue;
    let file;
    try { file = await open(path.join(folder, name), "r"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    try {
      const size = (await file.stat()).size;
      const start = Math.max(0, size - MAX_FILE_BYTES);
      const buffer = Buffer.alloc(Math.min(size, MAX_FILE_BYTES));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
      let content = buffer.subarray(0, bytesRead).toString("utf8");
      if (start > 0) {
        content = content.slice(content.indexOf("\n") + 1);
        warnings.add("High activity exceeded the history read limit. Counts cover the retained events shown here.");
      }
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        let event: AutomationHistoryEvent;
        try { event = schema.parse(JSON.parse(line)); } catch {
          warnings.add("Some history entries could not be read. Valid entries are still shown; counts may be incomplete.");
          continue;
        }
        if (Date.parse(event.at) < Date.parse(from) || Date.parse(event.at) > now.getTime() || event.automationId !== match[1]) continue;
        event.detail = historyDetail(event.detail);
        const previous = records.get(event.id);
        if (!previous || Date.parse(event.at) < Date.parse(previous.at)) records.set(event.id, event);
      }
    } finally { await file.close(); }
  }
  let events = [...records.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
  if (events.length > MAX_EVENTS) {
    events = events.slice(0, MAX_EVENTS);
    warnings.add("High activity exceeded the history event limit. Counts cover the newest 50,000 events.");
  }
  const delivery = events.filter((event) => event.scope === "delivery");
  const counts = {
    delivered: delivery.filter((event) => event.kind === "delivered").length,
    retrying: delivery.filter((event) => event.kind === "retrying").length,
    failed: delivery.filter((event) => event.kind === "failed").length,
    workerIssues: events.filter((event) => event.scope === "worker" && event.kind === "failed").length,
    scheduled: delivery.filter((event) => event.kind === "scheduled").length
  };
  const filtered = events.filter((event) => !query.kind || (query.kind === "activity" ? !(event.scope === "worker" && ["completed", "paused"].includes(event.kind)) : event.kind === query.kind));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.max(1, Math.min(pages, query.page ?? 1));
  return { from, to, counts, total: filtered.length, page, pages, events: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), warnings: [...warnings] };
}
