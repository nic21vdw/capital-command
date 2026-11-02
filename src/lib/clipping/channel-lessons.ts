import type { PostRow } from "@/lib/analytics/query";

/**
 * What the channel's own Shorts have taught: the titles that got watched and the
 * ones that did not. The clip picker, the virality judge and the title writer all
 * read it, so every stream's clips are chosen and named against real results
 * instead of a generic idea of "viral".
 *
 * The lists below are the measured YouTube results as of 2026-11-01 (public view
 * counts, 558 Shorts). Once the analytics store holds enough measured Shorts,
 * `readTitleLessons` replaces them with the live top and bottom of the channel,
 * so the lessons keep up without anyone editing this file.
 */

export type TitleLesson = { title: string; views: number };
export type TitleLessons = { worked: TitleLesson[]; flopped: TitleLesson[]; source: "analytics" | "baseline" };

export const BASELINE_LESSONS: TitleLessons = {
  source: "baseline",
  worked: [
    { title: "Yes, Grok Bot Will Blow Your Mind", views: 1892 },
    { title: "Hard Work Beats Talent When Talent Doesn't Work Hard", views: 1826 },
    { title: "When You Hit Claude Limits, You Need to Do This", views: 1410 },
    { title: "Stop Using the Wrong AI Model", views: 1236 },
    { title: "ChatGPT Usage Just Got Cut in Half?!", views: 1145 },
    { title: "Spend $20 on ChatGPT to Vibe Code an App", views: 1115 },
    { title: "GPT Astra Limits Are Cooked", views: 1107 },
    { title: "Is This AGI? GPT-6.1 Terra Built This COD Map in 2 Hours", views: 1065 },
    { title: "Who Was Behind the Pig Mask in My AI Saw Game?", views: 1035 },
    { title: "I Owe 500 Push-Ups to My Subscribers", views: 1008 }
  ],
  flopped: [
    { title: "Passion for AI Tech Drives This Project", views: 9 },
    { title: "My Secret to Getting Back Into Grind Mode", views: 45 },
    { title: "Why I Stream During Golden Hour", views: 57 },
    { title: "The Stream Goes On a Little Longer", views: 73 },
    { title: "Patience Is the Secret to Every Startup", views: 97 }
  ]
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** A Short this young has not had its first push yet. */
const MIN_AGE_DAYS = 3;
/** Older than this and the channel, the topics and the format have moved on. */
const MAX_AGE_DAYS = 120;
/** Fewer measured Shorts than this and the baseline is the better teacher. */
const MIN_MEASURED = 15;
const WORKED_COUNT = 10;
const FLOPPED_COUNT = 6;

/** Picks the channel's best and worst YouTube Shorts from analytics rows. Pure. */
export function rankTitleLessons(rows: PostRow[], now: Date): TitleLessons {
  const measured = rows
    .filter((row) => row.platform === "youtube" && row.format === "video" && row.status === "ok")
    .filter((row) => typeof row.metrics.views === "number" && row.title.trim())
    .filter((row) => {
      const age = (now.getTime() - Date.parse(row.publishedAt)) / DAY_MS;
      return Number.isFinite(age) && age >= MIN_AGE_DAYS && age <= MAX_AGE_DAYS;
    })
    .map((row) => ({ title: row.title.replace(/#[\w-]+/g, "").replace(/\s+/g, " ").trim(), views: row.metrics.views as number }))
    .filter((lesson) => lesson.title);
  if (measured.length < MIN_MEASURED) return BASELINE_LESSONS;
  const sorted = [...measured].sort((a, b) => b.views - a.views);
  return {
    source: "analytics",
    worked: sorted.slice(0, WORKED_COUNT),
    flopped: sorted.slice(-FLOPPED_COUNT).reverse()
  };
}

/** The lessons as a prompt block. Pure. */
export function titleLessonsBlock(lessons: TitleLessons): string {
  const line = (lesson: TitleLesson) => `- ${lesson.title} (${lesson.views.toLocaleString("en-US")} views)`;
  return [
    "What this channel's own Shorts have shown:",
    "These got watched. Each names one specific thing (a tool, a price, a number, a game, a result) or opens with a stake or a question:",
    ...lessons.worked.map(line),
    "These flopped. Each is a vague life lesson or a description of the stream with nothing to see or settle:",
    ...lessons.flopped.map(line)
  ].join("\n");
}

/** Reads the live lessons from the analytics store, falling back to the baseline. */
export async function readTitleLessons(now = new Date()): Promise<TitleLessons> {
  try {
    const { readMetrics } = await import("@/lib/analytics/store");
    const { rowsFromStore } = await import("@/lib/analytics/query");
    return rankTitleLessons(rowsFromStore(await readMetrics()), now);
  } catch {
    return BASELINE_LESSONS;
  }
}
