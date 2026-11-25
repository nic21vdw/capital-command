import { breaksPersona } from "@/lib/x-drafts/voice";
import { addDays } from "@/lib/x-drafts/schedule";
import type { DatedFact, FactTopic } from "@/lib/x-drafts/facts";

export const LIVE_SOURCES = ["stream", "streamNotes", "channel", "videos", "releases", "colateral", "arcade"] as const;
export type LiveSource = (typeof LIVE_SOURCES)[number];

export type SourceSnapshot = { at: string; ok: boolean; error?: string; facts: DatedFact[] };
export type LiveFactsSnapshot = { at: string; sources: Partial<Record<LiveSource, SourceSnapshot>> };

const COMMIT_DAYS = 7;
const VIDEO_DAYS = 7;
const RELEASE_DAYS = 14;

const PRIVATE = [
  /\bvb\s*&\s*s\b/i,
  /\bvbands\b/i,
  /\bfirmos\b/i,
  /\b(client|clients|job\s*#?\s*\d+|p\.?\s*eng)\b/i,
  /\b(csa|s16|a23|o86|s304|nbcc|obc)\b/i,
  /\b(beam(?!\s*buddy)|column|joist|girder|footing|rebar|slab)s?\b/i,
  /\b(secret|token|password|api key|stream key|credential)s?\b/i,
  /\b(revenue|income|salary|earning)s?\b/i
];

export function publicSafe(text: string): boolean {
  return !breaksPersona(text) && !PRIVATE.some((pattern) => pattern.test(text));
}

function fact(date: string, text: string, topic: FactTopic): DatedFact | null {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean && publicSafe(clean) ? { date, text: clean.slice(0, 300), topic } : null;
}

function present(entries: Array<DatedFact | null>): DatedFact[] {
  return entries.filter((entry): entry is DatedFact => entry !== null);
}

function within(date: string, today: string, days: number): boolean {
  return date >= addDays(today, -days) && date <= today;
}

function thousands(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export type StreamRecord = { title: string; ingestedAt: string; outcome?: string };

export function streamTitle(title: string): string {
  return title.split("|").map((part) => part.trim()).filter(Boolean)[0] ?? title.trim();
}

export function streamFacts(records: StreamRecord[], toDate: (iso: string) => string, today: string): DatedFact[] {
  const days = records
    .map((record) => ({ record, day: Number(record.title.match(/\bday\s*(\d{1,4})\b/i)?.[1] ?? NaN), date: toDate(record.ingestedAt) }))
    .filter((entry) => Number.isFinite(entry.day) && within(entry.date, today, RELEASE_DAYS))
    .sort((a, b) => b.day - a.day);
  const seen = new Set<number>();
  const newest = days.filter((entry) => !seen.has(entry.day) && seen.add(entry.day)).slice(0, 2);
  return present(
    newest.map((entry, index) =>
      fact(
        entry.date,
        index === 0
          ? `Day ${entry.day} of the nightly build stream is done. The stream is called "${streamTitle(entry.record.title)}".`
          : `Day ${entry.day} of the nightly build stream.`,
        "stream"
      )
    )
  );
}

export type StreamRun = { name?: string; createdAt?: string; posts?: Array<{ platform?: string; text?: string }> };

const MONEY = /[$€£]\s?\d|\bCA\$/;

export function streamNoteFacts(runs: StreamRun[], toDate: (iso: string) => string, today: string): DatedFact[] {
  const recent = runs
    .filter((run) => run.createdAt && run.posts?.length && within(toDate(run.createdAt), today, COMMIT_DAYS))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 2);
  return present(
    recent.flatMap((run, index) => {
      const day = run.name?.match(/\bday\s*(\d{1,4})\b/i)?.[1];
      const label = day ? `On the Day ${day} stream` : "On a recent stream";
      const posts = run.posts ?? [];
      const preferred = [...posts.filter((post) => post.platform === "threads"), ...posts.filter((post) => post.platform === "x")];
      const seen = new Set<string>();
      return preferred
        .map((post) => (post.text ?? "").replace(/\s+/g, " ").trim())
        .filter((text) => text.length > 40 && !MONEY.test(text) && !seen.has(text.slice(0, 60)) && seen.add(text.slice(0, 60)))
        .slice(0, index === 0 ? 3 : 1)
        .map((text) => fact(toDate(run.createdAt!), `${label}, in his own words: ${text}`, "stream"));
    })
  );
}

export function subscriberFacts(input: { subscribers: number | null; hidden?: boolean; goal: number; date: string }): DatedFact[] {
  if (input.hidden || input.subscribers === null || !Number.isFinite(input.subscribers) || input.subscribers <= 0) return [];
  const left = input.goal - input.subscribers;
  const text =
    left > 0
      ? `The YouTube channel is at about ${thousands(input.subscribers)} subscribers. The Road to 3K goal is ${thousands(input.goal)}, about ${thousands(left)} to go. At ${thousands(input.goal)} Nic does a 24 hour stream where chat picks what he builds.`
      : `The YouTube channel passed ${thousands(input.goal)} subscribers (about ${thousands(input.subscribers)} now), the Road to 3K goal.`;
  return present([fact(input.date, text, "channel")]);
}

export type VideoRow = { title: string; publishedAt: string; visibility: string | null; views: number | null; format: string };

export function videoFacts(rows: VideoRow[], toDate: (iso: string) => string, today: string): DatedFact[] {
  const recent = rows
    .filter((row) => row.visibility === "public" && row.title.trim() && within(toDate(row.publishedAt), today, VIDEO_DAYS))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const best = [...recent].filter((row) => (row.views ?? 0) > 0).sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];
  const picked = [...recent.slice(0, 3), ...(best && !recent.slice(0, 3).includes(best) ? [best] : [])];
  return present(
    picked.map((row) => {
      const kind = row.format === "long-form" ? "video" : "Short";
      const views = row.views && row.views > 0 ? ` It has ${thousands(row.views)} views so far.` : "";
      return fact(toDate(row.publishedAt), `New YouTube ${kind}: "${row.title.trim()}"${views ? "." : ""}${views}`, "videos");
    })
  );
}

export type ReleaseEntry = { tag_name?: string; name?: string | null; published_at?: string | null; draft?: boolean; prerelease?: boolean };

export function releaseFacts(releases: ReleaseEntry[], toDate: (iso: string) => string, today: string): DatedFact[] {
  return present(
    releases
      .filter((release) => !release.draft && !release.prerelease && release.published_at && release.tag_name)
      .map((release) => ({ version: release.tag_name!.replace(/^v/i, ""), date: toDate(release.published_at!) }))
      .filter((release) => /^\d+(\.\d+)+$/.test(release.version) && within(release.date, today, RELEASE_DAYS))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 2)
      .map((release) => fact(release.date, `CoLateral desktop ${release.version} came out on ${release.date}.`, "colateral"))
  );
}

const SKIP_SUBJECT = [
  /^merge\b/i,
  /^revert\b/i,
  /\[skip [a-z]+\]/i,
  /^(repair|fix) main\b/i,
  /^(release|point|bump|date|prepare|stage|verify|audit|test|tests|chore|ci|docs?|refactor|lint|wip)\b/i,
  /\bchangelog\b/i,
  /\brelease notes\b/i
];

export function commitSubjects(log: string): Array<{ date: string; subject: string }> {
  return log
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter((parts) => parts.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0]))
    .map(([date, ...rest]) => ({ date, subject: rest.join("\t").trim() }))
    .filter((entry) => /\(#\d+\)\s*$/.test(entry.subject) && !SKIP_SUBJECT.some((pattern) => pattern.test(entry.subject)))
    .map((entry) => ({ date: entry.date, subject: entry.subject.replace(/\s*\(#\d+\)\s*$/, "").replace(/\s*\((?:audit|fix|round)[^)]*\)/gi, "").trim() }));
}

export function commitFacts(log: string, kind: "colateral" | "arcade", today: string): DatedFact[] {
  const lead = kind === "arcade" ? "Live in the CoLateral Arcade" : "New in CoLateral";
  return present(
    commitSubjects(log)
      .filter((entry) => within(entry.date, today, COMMIT_DAYS))
      .slice(0, 4)
      .map((entry) => fact(entry.date, `${lead} (${entry.date}): ${entry.subject.replace(/[.\s]+$/, "")}.`, kind))
  );
}

export function liveFactsFrom(snapshot: LiveFactsSnapshot | null): DatedFact[] {
  if (!snapshot) return [];
  return LIVE_SOURCES.flatMap((source) => snapshot.sources[source]?.facts ?? []);
}

export function mergeSnapshot(previous: LiveFactsSnapshot | null, results: Partial<Record<LiveSource, SourceSnapshot>>, at: string): LiveFactsSnapshot {
  const sources: Partial<Record<LiveSource, SourceSnapshot>> = {};
  for (const source of LIVE_SOURCES) {
    const fresh = results[source];
    const old = previous?.sources[source];
    if (fresh?.ok) sources[source] = fresh;
    else if (fresh) sources[source] = { ...fresh, facts: old?.facts ?? [] };
    else if (old) sources[source] = old;
  }
  return { at, sources };
}
