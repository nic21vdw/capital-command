import { describe, expect, it } from "vitest";
import type { PostRecord } from "@/lib/analytics/types";
import { findWinners } from "@/lib/winners/detect";
import { parseRemix, remixProblems, retestPlan, sameHook } from "@/lib/winners/remix";
import type { ExternalPost, Remix, Winner } from "@/lib/winners/types";

const DAY = 86_400_000;
const NOW = new Date("2026-11-27T23:00:00.000Z");

let counter = 0;
function post(daysAgo: number, value: number, overrides: Partial<PostRecord> = {}, metric: "views" | "likes" = "views"): PostRecord {
  counter += 1;
  const published = NOW.getTime() - daysAgo * DAY;
  const history = [1, 3, 7, 14]
    .filter((day) => day <= daysAgo)
    .map((day) => {
      const at = new Date(published + day * DAY).toISOString();
      return { date: at.slice(0, 10), at, [metric]: Math.round((value * Math.min(day, 7)) / 7) };
    });
  const latest = history.length > 0 ? { at: history[history.length - 1].at, metrics: { [metric]: history[history.length - 1][metric] as number } } : null;
  return {
    key: `youtube:p${counter}`,
    platform: "youtube",
    accountId: "youtube-primary",
    postId: `p${counter}`,
    itemId: `item-${counter}`,
    format: "video",
    title: `Post ${counter}`,
    caption: "",
    publishedAt: new Date(published).toISOString(),
    status: "ok",
    latest,
    history,
    misses: 0,
    ...overrides
  };
}

function baseline(count: number, value: number, metric: "views" | "likes" = "views", overrides: Partial<PostRecord> = {}): PostRecord[] {
  return Array.from({ length: count }, (_, index) => post(20 + index, value, overrides, metric));
}

describe("findWinners", () => {
  it("flags a post at twice the median and leaves the rest", () => {
    const winner = post(10, 900, { title: "Big one" });
    const ordinary = post(9, 250);
    const found = findWinners([...baseline(12, 200), winner, ordinary], NOW);
    expect(found.map((item) => item.title)).toEqual(["Big one"]);
    expect(found[0].evidence[0]).toMatchObject({ metric: "views", value: 900, median: 200, ratio: 4.5 });
  });

  it("compares a young post with its peers at the same age", () => {
    const young = post(1.5, 14_700, { title: "Two days old" });
    const found = findWinners([...baseline(12, 1400), young], NOW);
    expect(found).toHaveLength(1);
    expect(found[0].evidence[0].ageDays).toBe(1.5);
  });

  it("ignores a post under a day old, one past the window, and a thin baseline", () => {
    expect(findWinners([...baseline(12, 200), post(0.5, 5000)], NOW)).toEqual([]);
    expect(findWinners([...baseline(12, 200), post(40, 5000)], NOW).map((item) => item.title)).not.toContain("Post 0");
    expect(findWinners([...baseline(4, 200), post(10, 5000)], NOW)).toEqual([]);
  });

  it("needs a real number, not two likes against a median of one", () => {
    const instagram = { platform: "instagram" as const, accountId: "instagram-primary" };
    const small = post(10, 4, instagram, "likes");
    const real = post(11, 14, { ...instagram, title: "Liked" }, "likes");
    const found = findWinners([...baseline(12, 2, "likes", instagram), small, real], NOW);
    expect(found.map((item) => item.title)).toEqual(["Liked"]);
    expect(found[0].evidence[0].metric).toBe("engagements");
  });

  it("merges one clip that won on two platforms into one idea", () => {
    const youtube = post(10, 900, { itemId: "clip-a", title: "Shared" });
    const instagram = post(10, 30, { itemId: "clip-a", title: "Shared", platform: "instagram", accountId: "instagram-primary" }, "likes");
    const found = findWinners([...baseline(12, 200), ...baseline(12, 3, "likes", { platform: "instagram", accountId: "instagram-primary" }), youtube, instagram], NOW);
    expect(found).toHaveLength(1);
    expect(found[0].evidence.map((item) => item.platform).sort()).toEqual(["instagram", "youtube"]);
  });

  it("reads X winners only from the posts Nic typed in", () => {
    const typed: ExternalPost[] = Array.from({ length: 12 }, (_, index) => ({
      platform: "x",
      id: `x${index}`,
      text: `Post ${index}`,
      postedAt: new Date(NOW.getTime() - (3 + index) * DAY).toISOString(),
      views: index === 0 ? 24_600 : 4_000
    }));
    const found = findWinners([], NOW, typed);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ ideaId: "x:x0", title: "Post 0" });
  });
});

const WINNER: Winner = {
  ideaId: "item-1",
  title: "Grok 4.7 Was a Disaster. Where's Grok 4.8?",
  caption: "",
  publishedAt: "2026-11-26T12:30:00.000Z",
  evidence: [],
  bestRatio: 6.6
};

const GOOD = {
  angle: "Grok's silence vs Dots shipping",
  short: {
    hook: "Grok has gone quiet and Dots keeps shipping.",
    lines: ["Grok 4.7 got delayed, then launched rough.", "Still nothing on Grok 4.8.", "Meanwhile Dots keeps getting better."],
    cta: "When does Grok drop next? Let me know in the comments.",
    headlines: ["Gone quiet", "No 4.8", "Dots ships"],
    broll: ["Grok release page", "Dots changelog"]
  },
  threads: "Honest question for anyone still on Grok.\n\nIt has been quiet since 4.7 and there is no word on 4.8. Dots keeps shipping.\n\nWhat keeps you there?",
  tweet: "Grok 4.8 is the most important launch xAI hasn't announced.\n\n4.7 got delayed, then shipped rough, and nothing since. Meanwhile ChatGPT Dots keeps getting better every week.\n\nWhen do you think the next Grok drop lands?",
  retestHook: "Where is Grok 4.8?",
  flags: []
};

describe("remix", () => {
  it("parses a clean answer and passes every gate", () => {
    const remix = parseRemix("```json\n" + JSON.stringify(GOOD) + "\n```", NOW, "America/Toronto");
    expect(remix.short.lines).toHaveLength(3);
    expect(remixProblems(remix, WINNER)).toEqual([]);
  });

  it("refuses a recycled hook, an engineering pitch, a link and a dash", () => {
    const bad: Remix = {
      ...parseRemix(JSON.stringify(GOOD), NOW, "America/Toronto"),
      threads: "CoLateral is structural engineering software, try colateralai.com",
      tweet: "Big news — no model named here.\n\nNo question at the end."
    };
    bad.short = { ...bad.short, hook: "Grok 4.7 was a disaster, honestly." };
    const problems = remixProblems(bad, WINNER).join("; ");
    expect(problems).toContain("short: hook repeats the original");
    expect(problems).toContain("threads: has a link");
    expect(problems).toContain("threads: talks about engineering work");
    expect(problems).toContain("tweet: has a dash");
    expect(problems).toContain("tweet:");
  });

  it("plans the retest inside the week, never today", () => {
    const plan = retestPlan(NOW, "America/Toronto", "Where is Grok 4.8?");
    expect(plan).toMatchObject({ from: "2026-11-28", by: "2026-12-04", hook: "Where is Grok 4.8?" });
  });

  it("compares hooks by their opening words", () => {
    expect(sameHook("Grok 4.7 was a disaster!", "grok 4.7 was a DISASTER. Where's 4.8")).toBe(true);
    expect(sameHook("Where is Grok 4.8?", "Grok 4.7 was a disaster")).toBe(false);
  });
});
