import { describe, expect, it } from "vitest";
import { factTopics, freshFacts, mergeFacts, type DatedFact } from "@/lib/x-drafts/facts";
import { draftsPrompt, mixFor, POST_MIX, TOPIC_SLOTS } from "@/lib/x-drafts/generator";
import { collectLiveFacts, type LiveFactDeps } from "@/lib/x-drafts/liveFactSources";
import {
  commitFacts,
  commitSubjects,
  mergeSnapshot,
  publicSafe,
  releaseFacts,
  streamFacts,
  streamNoteFacts,
  subscriberFacts,
  videoFacts,
  type LiveFactsSnapshot
} from "@/lib/x-drafts/liveFacts";

const toDate = (iso: string) => iso.slice(0, 10);
const TODAY = "2026-11-24";

describe("stream facts", () => {
  it("takes the newest Day number and drops the revenue part of the title", () => {
    const facts = streamFacts(
      [
        { title: "Vibe Coding Until I Can Move Out of My Mom’s Basement | Day 103 | Est. Revenue CA$6,727.31", ingestedAt: "2026-11-23T12:12:31Z" },
        { title: "Vibe Coding Until I Can Move Out of My Mom’s Basement | Day 104 | Generated Revenue CA$6,729.86", ingestedAt: "2026-11-24T12:00:46Z" },
        { title: "Day 40", ingestedAt: "2026-08-20T12:00:00Z" },
        { title: "A commute video", ingestedAt: "2026-11-24T12:00:00Z" }
      ],
      toDate,
      TODAY
    );
    expect(facts).toEqual([
      { date: "2026-11-24", topic: "stream", text: "Day 104 of the nightly build stream is done. The stream is called \"Vibe Coding Until I Can Move Out of My Mom’s Basement\"." },
      { date: "2026-11-23", topic: "stream", text: "Day 103 of the nightly build stream." }
    ]);
    expect(facts.some((fact) => fact.text.includes("CA$"))).toBe(false);
  });
});

describe("stream notes", () => {
  it("takes the newest run's Threads posts as his own words, and drops money", () => {
    const facts = streamNoteFacts(
      [
        {
          name: "Basement | Day 104 | Generated Revenue CA$6,729.86",
          createdAt: "2026-11-24T10:00:09Z",
          posts: [
            { platform: "x", text: "Day 104. $6,729.86 generated so far. Today's job was getting Donna to read chat." },
            { platform: "x", text: "Lesson from today: an AI agent took 42 minutes to remove one panel. Budget for the slow parts." },
            { platform: "threads", text: "One of my agents paused Claude until after the stream ended. I never told it to do that." },
            { platform: "facebook", text: "On Day 104 of building CoLateral live, I spent the stream on Donna. Come watch." }
          ]
        },
        { name: "Day 103", createdAt: "2026-11-23T10:00:00Z", posts: [{ platform: "threads", text: "Day 103 notes that are long enough to count as a note here." }, { platform: "threads", text: "A second Day 103 note that is also long enough to be kept." }] },
        { name: "Day 90", createdAt: "2026-11-10T10:00:00Z", posts: [{ platform: "threads", text: "Old enough that it should be left out of the notes entirely." }] }
      ],
      toDate,
      TODAY
    );
    expect(facts.map((fact) => fact.text)).toEqual([
      "On the Day 104 stream, in his own words: One of my agents paused Claude until after the stream ended. I never told it to do that.",
      "On the Day 104 stream, in his own words: Lesson from today: an AI agent took 42 minutes to remove one panel. Budget for the slow parts.",
      "On the Day 103 stream, in his own words: Day 103 notes that are long enough to count as a note here."
    ]);
    expect(facts.every((fact) => fact.topic === "stream")).toBe(true);
  });
});

describe("subscriber facts", () => {
  it("says how far the Road to 3K is, as an approximate count", () => {
    const [fact] = subscriberFacts({ subscribers: 1240, goal: 3000, date: TODAY });
    expect(fact.topic).toBe("channel");
    expect(fact.text).toContain("about 1,240 subscribers");
    expect(fact.text).toContain("about 1,760 to go");
  });

  it("says nothing when the count is hidden or missing", () => {
    expect(subscriberFacts({ subscribers: 1240, hidden: true, goal: 3000, date: TODAY })).toEqual([]);
    expect(subscriberFacts({ subscribers: null, goal: 3000, date: TODAY })).toEqual([]);
  });
});

describe("video facts", () => {
  it("keeps public uploads from the last week, newest first, plus the best one", () => {
    const facts = videoFacts(
      [
        { title: "Old one", publishedAt: "2026-11-01T12:00:00Z", visibility: "public", views: 9000, format: "video" },
        { title: "Private one", publishedAt: "2026-11-23T12:00:00Z", visibility: "private", views: null, format: "video" },
        { title: "Brandyn Vibe-Coded a Paintball Game. It Actually Rips.", publishedAt: "2026-11-22T20:14:09Z", visibility: "public", views: 442, format: "video" },
        { title: "Day 1 vs Day 100 of Streaming", publishedAt: "2026-11-19T20:36:45Z", visibility: "public", views: 0, format: "video" }
      ],
      toDate,
      TODAY
    );
    expect(facts.map((fact) => fact.text)).toEqual([
      "New YouTube Short: \"Brandyn Vibe-Coded a Paintball Game. It Actually Rips.\". It has 442 views so far.",
      "New YouTube Short: \"Day 1 vs Day 100 of Streaming\""
    ]);
  });
});

describe("release facts", () => {
  it("only counts published desktop releases from the last two weeks", () => {
    const facts = releaseFacts(
      [
        { tag_name: "v1.0.95", published_at: "2026-11-24T09:32:33Z", draft: false, prerelease: false },
        { tag_name: "v1.0.96", published_at: null, draft: true },
        { tag_name: "v1.0.94", published_at: "2026-11-23T09:09:08Z" },
        { tag_name: "v1.0.93", published_at: "2026-11-21T22:50:38Z" },
        { tag_name: "v1.0.70", published_at: "2026-10-01T00:00:00Z" }
      ],
      toDate,
      TODAY
    );
    expect(facts.map((fact) => fact.text)).toEqual(["CoLateral desktop 1.0.95 came out on 2026-11-24.", "CoLateral desktop 1.0.94 came out on 2026-11-23."]);
  });
});

describe("commit facts", () => {
  const log = [
    "2026-11-24\tPoint the download page at CoLateral 1.0.95 (#3006)",
    "2026-11-24\tRelease CoLateral 1.0.95",
    "2026-11-24\tMake notifications calm and glass: corner popups, bell panel, settings toasts (#2990)",
    "2026-11-24\tRepair main: drop preview revision records for the removed founder photos (#3004)",
    "2026-11-23\tStop agent terminals sitting blank in the Command Centre (#3000)",
    "2026-11-18\tPrepare protected wardrobe publishers (#274) [skip actions]",
    "2026-11-17\tMerge pull request #268 from nic21vdw/claude/project-thread-lqqbfn",
    "2026-11-22\tAdd a beam designer to the VB&S tools (#2980)",
    "2026-11-01\tSomething old (#2000)"
  ].join("\n");

  it("keeps merged pull requests and drops release chores, repairs and merges", () => {
    expect(commitSubjects(log).map((entry) => entry.subject)).toEqual([
      "Make notifications calm and glass: corner popups, bell panel, settings toasts",
      "Stop agent terminals sitting blank in the Command Centre",
      "Add a beam designer to the VB&S tools",
      "Something old"
    ]);
  });

  it("writes recent ones as facts and never lets engineering or VB&S work through", () => {
    expect(commitFacts(log, "colateral", TODAY).map((fact) => fact.text)).toEqual([
      "New in CoLateral (2026-11-24): Make notifications calm and glass: corner popups, bell panel, settings toasts.",
      "New in CoLateral (2026-11-23): Stop agent terminals sitting blank in the Command Centre."
    ]);
    expect(commitFacts("2026-11-18\tZombies: fix the lobby on every map and add a load cinematic (#276)", "arcade", TODAY)[0]).toEqual({
      date: "2026-11-18",
      topic: "arcade",
      text: "Live in the CoLateral Arcade (2026-11-18): Zombies: fix the lobby on every map and add a load cinematic."
    });
  });

  it("lets Beam Buddy through but not structural words or secrets", () => {
    expect(publicSafe("Beam Buddy can call you now")).toBe(true);
    expect(publicSafe("Steel beam sizing per S16")).toBe(false);
    expect(publicSafe("Rotate the stream key")).toBe(false);
    expect(publicSafe("CoLateral is structural software")).toBe(false);
  });
});

describe("the live snapshot", () => {
  it("keeps a failed source's last good facts", () => {
    const previous: LiveFactsSnapshot = { at: "2026-11-23T00:00:00Z", sources: { channel: { at: "2026-11-23T00:00:00Z", ok: true, facts: [{ date: "2026-11-23", text: "old count", topic: "channel" }] } } };
    const next = mergeSnapshot(previous, { channel: { at: "2026-11-24T00:00:00Z", ok: false, error: "quota", facts: [] } }, "2026-11-24T00:00:00Z");
    expect(next.sources.channel).toEqual({ at: "2026-11-24T00:00:00Z", ok: false, error: "quota", facts: [{ date: "2026-11-23", text: "old count", topic: "channel" }] });
  });

  it("collects every source, survives one throwing, and writes the snapshot", async () => {
    let written: LiveFactsSnapshot | null = null;
    const deps: LiveFactDeps = {
      streams: async () => [{ title: "Basement | Day 104", ingestedAt: "2026-11-24T12:00:00Z" }],
      runs: async () => [],
      subscribers: async () => {
        throw new Error("YouTube quota saved for uploads");
      },
      videos: async () => [],
      releases: async () => [{ tag_name: "v1.0.95", published_at: "2026-11-24T09:32:33Z" }],
      colateralLog: async () => "",
      arcadeLog: async () => "2026-11-18\tRelease Cargo Rush v2 for Nic Ops (#263)",
      readSnapshot: async () => null,
      writeSnapshot: async (snapshot) => {
        written = snapshot;
      }
    };
    const { facts, snapshot } = await collectLiveFacts({ now: new Date("2026-11-24T17:00:00Z"), today: TODAY, timeZone: "America/Toronto", deps });
    expect(facts.map((fact) => fact.topic)).toEqual(["stream", "colateral"]);
    expect(snapshot.sources.channel).toMatchObject({ ok: false, error: "YouTube quota saved for uploads" });
    expect(written).toEqual(snapshot);
  });
});

describe("mixing topics into the day", () => {
  const facts: DatedFact[] = [
    { date: "2026-11-24", text: "Day 104", topic: "stream" },
    { date: "2026-11-24", text: "1.0.95", topic: "colateral" },
    { date: "2026-11-18", text: "Zombies lobby", topic: "arcade" },
    { date: "2026-11-22", text: "Jelly Brawl Short", topic: "videos" },
    { date: "2026-11-24", text: "1,240 subs", topic: "channel" }
  ];

  it("keeps hand-written facts first and caps no topic below six", () => {
    const merged = mergeFacts([{ date: "2026-11-19", text: "1.0.95" }], facts);
    expect(merged.filter((fact) => fact.text === "1.0.95")).toHaveLength(1);
    expect(factTopics(merged)).toEqual(["stream", "channel", "arcade", "videos"]);
  });

  it("falls back to the fixed mix with no topic facts", () => {
    expect(mixFor(4)).toEqual(POST_MIX.slice(0, 4));
  });

  it("alternates model takes with topic posts and rotates which topics lead each day", () => {
    const topics = factTopics(facts);
    const day1 = mixFor(4, topics, "2026-11-25");
    const day2 = mixFor(4, topics, "2026-11-26");
    expect(day1.filter((slot) => Object.values(TOPIC_SLOTS).includes(slot))).toHaveLength(2);
    expect(day1[1]).not.toBe(day2[1]);
    const ten = mixFor(10, topics, "2026-11-25");
    expect(new Set(ten.filter((slot) => Object.values(TOPIC_SLOTS).includes(slot)))).toEqual(new Set(Object.values(TOPIC_SLOTS)));
  });

  it("groups the facts by topic in the prompt and asks for spread", () => {
    const { prompt } = draftsPrompt({ date: "2026-11-25", count: 4, recentOpenings: [], facts: [{ date: "2026-11-19", text: "Switched to ChatGPT Pro" }, ...facts] });
    expect(prompt).toContain("- 2026-11-19: Switched to ChatGPT Pro");
    expect(prompt).toContain("The CoLateral Arcade (what went live):\n- 2026-11-18: Zombies lobby");
    expect(prompt).toContain("touch several of these areas");
    expect(prompt).toContain("still opens on a hook that names a model or product");
  });

  it("reads a topic from the hand-written file only when it is a known one", () => {
    expect(freshFacts([{ date: TODAY, text: "a", topic: "arcade" }, { date: TODAY, text: "b", topic: "golf" }], TODAY)).toEqual([
      { date: TODAY, text: "a", topic: "arcade" },
      { date: TODAY, text: "b" }
    ]);
  });
});
