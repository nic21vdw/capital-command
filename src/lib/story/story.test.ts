import { describe, expect, it } from "vitest";
import { cleanRange, countFillers, detectDisfluencies } from "@/lib/story/cleanup";
import { buildEdl, mergeBreaths, PUSH_TO, retime, timelineWords, zoomAnchor, type EdlUnit } from "@/lib/story/edl";
import { faceFraming, planShots, SCREEN_ZOOM, summarizeShots } from "@/lib/story/shots";
import { hookCaptionsAss } from "@/lib/story/publish";
import { assertPrivate, PrivacyGuardError, STORY_PRIVACY, storyStatus } from "@/lib/story/privacy";
import {
  buildDescription,
  buildSrt,
  chapterBlock,
  chaptersFromTimeline,
  normalizeChapters,
  srtTime,
  validateChapters,
  validateTitles
} from "@/lib/story/publish";
import { chunkFilter, planChunks, videoAssembly, zoomFilter } from "@/lib/story/render";
import { buildMoments, fitRuntime, locateQuote, orderedUnitIds, TARGET_MAX_SEC, TARGET_MIN_SEC, validLoops } from "@/lib/story/story";
import type { EdlSegment, Moment, StoryCopy, StoryPlan, Unit, UnitScores, VisualSample, Word } from "@/lib/story/types";
import { bestTake, findRetakeGroups, splitUnits } from "@/lib/story/units";
import { fitTitle } from "@/lib/story/pipeline";
import { storyVideoBody, uploadStoryVideo } from "@/lib/story/youtube";

function words(text: string, start = 0, step = 0.3, gap = 0.05): Word[] {
  return text.split(" ").map((w, index) => ({ w, s: start + index * step, e: start + index * step + step - gap }));
}

const scores = (combined: number): UnitScores => ({
  story: combined,
  clarity: 0.8,
  emotion: 0.5,
  visual: 0.6,
  delivery: 0.6,
  novelty: 0.5,
  audio: 0.7,
  combined
});

function unit(id: string, start: number, end: number, text: string, combined = 0.5, firstWord = 0, lastWord = 0): Unit {
  return {
    id,
    start,
    end,
    firstWord,
    lastWord,
    text,
    audio: { clarity: 0.8, energy: 0.6, paceWpm: 160, fillerRate: 0 },
    visual: { sharpness: 0.6, exposure: 0.7, framing: 0.8, eyeContact: 0.7, motion: 0.5, gesture: 0.4, variety: 0.2, unusable: [] },
    scores: scores(combined),
    reason: "steady delivery"
  };
}

describe("filler detection", () => {
  it("flags um, uh, filler like and filler you know, but not verb like or you know what", () => {
    const list = words("So um I was, like, thinking we should ship it. I like pizza and you know what I mean. It works, you know, mostly uh yeah");
    const flagged = detectDisfluencies(list).filter((flag) => flag.kind === "filler").map((flag) => list[flag.index].w);
    expect(flagged).toEqual(["um", "like,", "you", "know,", "uh"]);
  });

  it("flags stutters, repeated phrases and false starts", () => {
    const list = words("I I think we need to we need to fix the wh- the build today");
    const kinds = detectDisfluencies(list).map((flag) => `${list[flag.index].w}:${flag.kind}`);
    expect(kinds).toContain("I:stutter");
    expect(kinds).toContain("we:repeat");
    expect(kinds).toContain("wh-:false-start");
    expect(kinds).not.toContain("fix:repeat");
  });

  it("counts fillers the way re-transcription is judged", () => {
    expect(countFillers(words("um so uh this is, like, it"))).toBe(3);
  });
});

describe("silence trimming", () => {
  it("tightens a long pause to the target gap and never cuts inside a word", () => {
    const list: Word[] = [
      { w: "first", s: 0, e: 0.4 },
      { w: "second.", s: 2.4, e: 2.8 },
      { w: "third", s: 2.9, e: 3.2 }
    ];
    const result = cleanRange(list, 0, 2, new Map());
    expect(result.ranges).toHaveLength(2);
    const [a, b] = result.ranges;
    expect(a.end).toBeGreaterThanOrEqual(0.4);
    expect(b.start).toBeLessThanOrEqual(2.4);
    const kept = a.end - 0.4 + (2.4 - b.start);
    expect(kept).toBeGreaterThanOrEqual(0.15);
    expect(kept).toBeLessThanOrEqual(0.3);
    expect(result.removals.some((removal) => removal.kind === "silence")).toBe(true);
  });

  it("keeps a dramatic pause up to 0.6 s", () => {
    const list: Word[] = [
      { w: "wait.", s: 0, e: 0.4 },
      { w: "boom", s: 1.4, e: 1.8 }
    ];
    const [a, b] = cleanRange(list, 0, 1, new Map(), new Set([0])).ranges;
    expect(a.end - 0.4 + (1.4 - b.start)).toBeCloseTo(0.6, 2);
  });

  it("cuts a filler out at its word boundaries", () => {
    const list = words("this um works");
    const result = cleanRange(list, 0, 2, new Map([[1, "filler" as const]]));
    expect(result.ranges).toHaveLength(2);
    expect(result.ranges[0].end).toBeLessThanOrEqual(list[1].s + 1e-9);
    expect(result.ranges[1].start).toBeGreaterThanOrEqual(list[1].e - 1e-9);
  });
});

describe("retake selection", () => {
  it("groups repeated attempts at the same line and keeps the best combined score", () => {
    const units = [
      { id: "a", start: 0, end: 5, text: "the new dashboard loads every revenue number instantly now", combined: 0.4 },
      { id: "b", start: 7, end: 12, text: "the new dashboard loads every revenue number instantly", combined: 0.7 },
      { id: "c", start: 20, end: 25, text: "completely different sentence about chat and pushups", combined: 0.9 }
    ];
    const groups = findRetakeGroups(units);
    expect(groups).toEqual([["a", "b"]]);
    expect(bestTake(groups[0], new Map(units.map((u) => [u.id, u])))).toBe("b");
  });
});

describe("units", () => {
  it("splits on sentence ends and long gaps", () => {
    const list: Word[] = [...words("This is the first sentence."), ...words("And a second one here", 5)];
    expect(splitUnits(list).map((u) => u.text)).toEqual(["This is the first sentence.", "And a second one here"]);
  });
});

function edlUnits(): { list: Word[]; entries: EdlUnit[] } {
  const list = [...words("one um two uh three four five six seven"), ...words("payoff line that matters a lot here now", 10, 0.5)];
  const u1 = unit("u1", 0, 2.7, "", 0.5, 0, 8);
  const u2 = unit("u2", 10, 14, "", 0.8, 9, 16);
  return {
    list,
    entries: [
      { unit: u1, section: "setup", key: false, dramatic: false },
      { unit: u2, section: "payoff", key: true, dramatic: false }
    ]
  };
}

describe("EDL generation", () => {
  const { list, entries } = edlUnits();
  const flags = detectDisfluencies(list);
  const built = buildEdl({
    source: "src.mp4",
    fps: 30,
    width: 1920,
    height: 1080,
    words: list,
    flags,
    units: entries,
    envelope: null,
    hopSec: 0.01,
    anchorFor: () => ({ x: 0.5, y: 0.5, source: "frame" })
  });

  it("gives every segment audio and visual scores and a reason", () => {
    for (const segment of built.edl.segments) {
      expect(segment.audioScore).toBeGreaterThan(0);
      expect(segment.visualScore).toBeGreaterThan(0);
      expect(segment.reason.length).toBeGreaterThan(5);
    }
  });

  it("keeps jump cuts at the same framing and pushes in on a key line", () => {
    const setup = built.edl.segments.filter((segment) => segment.section === "setup");
    expect(setup.map((segment) => segment.transition)).toEqual(["cut", "jump", "jump"]);
    expect(setup.map((segment) => segment.zoom)).toEqual([1, 1, 1]);
    const payoff = built.edl.segments.find((segment) => segment.section === "payoff")!;
    expect(payoff.transition).toBe("j-cut");
    expect(payoff.zoom).toBe(1);
    expect(payoff.zoomTo).toBe(PUSH_TO);
  });

  it("frame-aligns every in and out point and lays the timeline end to end", () => {
    for (const segment of built.edl.segments) {
      expect(Math.abs(segment.in * 30 - Math.round(segment.in * 30))).toBeLessThan(1e-6);
      expect(Math.abs(segment.out * 30 - Math.round(segment.out * 30))).toBeLessThan(1e-6);
    }
    const total = built.edl.segments.reduce((sum, segment) => sum + segment.out - segment.in, 0);
    expect(built.edl.runtimeSec).toBeCloseTo(total, 6);
  });

  it("removes filler words from the caption timeline", () => {
    const heard = timelineWords(built.edl.segments, list).map((word) => word.w);
    expect(heard).not.toContain("um");
    expect(heard).not.toContain("uh");
    expect(heard).toContain("payoff");
  });

  it("retimes after a segment is toggled off", () => {
    const toggled = built.edl.segments.map((segment, index) => (index === 0 ? { ...segment, enabled: false } : segment));
    const { runtimeSec, segments } = retime(toggled);
    expect(runtimeSec).toBeCloseTo(built.edl.runtimeSec - (built.edl.segments[0].out - built.edl.segments[0].in), 6);
    expect(segments[1].timelineIn).toBe(0);
  });
});

describe("zoom anchor", () => {
  const sample = (h: number, x: number): VisualSample => ({
    t: 0,
    sharp: 100,
    luma: 120,
    contrast: 40,
    motion: 1,
    cut: false,
    face: { x, y: 0.05, w: h * 0.56, h, conf: 0.9, front: 0.9, sharp: 80, luma: 120, gesture: 2 }
  });

  it("never centres a zoom on a small corner facecam", () => {
    expect(zoomAnchor(Array.from({ length: 10 }, () => sample(0.13, 0.75)))).toEqual({ x: 0.5, y: 0.5, source: "frame" });
  });

  it("centres on the face when it fills a talking-head share of the frame", () => {
    const anchor = zoomAnchor(Array.from({ length: 10 }, () => sample(0.35, 0.4)));
    expect(anchor.source).toBe("face");
  });
});

describe("runtime targeting", () => {
  const moments: Moment[] = Array.from({ length: 30 }, (_, index) => ({
    id: `m${index}`,
    unitIds: [`u${index}`],
    start: index * 100,
    end: index * 100 + 60,
    text: "",
    score: 0.3 + (index % 10) / 20
  }));
  const runtimeOf = () => 60;
  const base: StoryPlan = {
    hookUnitIds: ["u0"],
    hookReason: "",
    sections: [
      { role: "setup", title: "Setup", momentIds: ["m1"], reason: "" },
      { role: "development", title: "Build", momentIds: ["m2", "m3"], reason: "" },
      { role: "payoff", title: "Payoff", momentIds: ["m9"], reason: "" }
    ],
    openLoops: [],
    source: "ai",
    targetSec: 600
  };

  it("fills a short plan up to the 8-12 minute window", () => {
    const plan = fitRuntime({ plan: base, moments, runtimeOf, hookSec: 20, unitMoment: new Map(), minMomentScore: 0 });
    const runtime = 20 + plan.sections.flatMap((s) => s.momentIds).length * 60;
    expect(runtime).toBeGreaterThanOrEqual(TARGET_MIN_SEC);
    expect(runtime).toBeLessThanOrEqual(TARGET_MAX_SEC);
    expect(plan.shortfall).toBeUndefined();
  });

  it("trims a long plan back under 12 minutes", () => {
    const long: StoryPlan = { ...base, sections: [{ role: "development", title: "Build", momentIds: moments.map((m) => m.id), reason: "" }] };
    const plan = fitRuntime({ plan: long, moments, runtimeOf, hookSec: 20, unitMoment: new Map(), minMomentScore: 0 });
    expect(20 + plan.sections.flatMap((s) => s.momentIds).length * 60).toBeLessThanOrEqual(TARGET_MAX_SEC);
  });

  it("reports a shortfall instead of padding with weak moments", () => {
    const plan = fitRuntime({ plan: base, moments: moments.slice(0, 5), runtimeOf, hookSec: 20, unitMoment: new Map(), minMomentScore: 0.99 });
    expect(plan.shortfall).toMatch(/short of the 8:00 floor/);
  });
});

describe("story order", () => {
  it("opens on the hook from anywhere and keeps loops only when planted before they pay off", () => {
    const units = new Map(["u1", "u2", "u3", "u9"].map((id, index) => [id, unit(id, index * 10, index * 10 + 5, id)]));
    const moments = buildMoments([...units.values()]);
    const plan: StoryPlan = {
      hookUnitIds: ["u9"],
      hookReason: "",
      sections: [{ role: "setup", title: "Setup", momentIds: moments.map((m) => m.id), reason: "" }],
      openLoops: [],
      source: "ai",
      targetSec: 600
    };
    const order = orderedUnitIds(plan, moments, units, new Set());
    expect(order[0]).toBe("u9");
    expect(validLoops([{ plantUnitId: "u1", payoffUnitId: "u3", question: "" }, { plantUnitId: "u3", payoffUnitId: "u1", question: "" }], order)).toHaveLength(1);
  });

  it("locates a quoted hook inside its moment", () => {
    const units = [unit("a", 0, 5, "we were just setting up the stream"), unit("b", 5, 12, "and then it made three thousand dollars overnight")];
    expect(locateQuote("made three thousand dollars overnight", units)).toEqual(["b"]);
  });
});

describe("chapters", () => {
  it("formats chapters starting at 00:00, ascending, at least 10 s apart", () => {
    const chapters = normalizeChapters(
      [
        { seconds: 3, title: "Cold open tease" },
        { seconds: 25, title: "Why today matters" },
        { seconds: 30, title: "Too close to count" },
        { seconds: 200, title: "The build breaks" },
        { seconds: 590, title: "What it earned" }
      ],
      600
    );
    expect(chapterBlock(chapters)).toBe("00:00 Cold open tease\n00:25 Why today matters\n03:20 The build breaks\n09:50 What it earned");
    expect(validateChapters(chapters, 600).ok).toBe(true);
  });

  it("rejects fewer than three chapters or one that does not start at zero", () => {
    expect(validateChapters([{ seconds: 5, title: "Only one here" }], 600).ok).toBe(false);
    expect(validateChapters([{ seconds: 0, title: "a b" }, { seconds: 5, title: "c d" }, { seconds: 100, title: "e f" }], 600).problems.join()).toMatch(/under 10s/);
  });

  it("derives chapters from story sections on the final timeline", () => {
    const segment = (id: string, unitId: string, timelineIn: number): EdlSegment =>
      ({ id, unitId, timelineIn, timelineOut: timelineIn + 5, enabled: true }) as EdlSegment;
    const plan: StoryPlan = {
      hookUnitIds: ["u5"],
      hookReason: "",
      sections: [
        { role: "setup", title: "Why it matters", momentIds: ["m1"], reason: "" },
        { role: "payoff", title: "What it earned", momentIds: ["m2"], reason: "" }
      ],
      openLoops: [],
      source: "ai",
      targetSec: 600
    };
    const chapters = chaptersFromTimeline(
      [segment("hook-u5.1", "u5", 0), segment("u1.1", "u1", 20), segment("u2.1", "u2", 300)],
      plan,
      new Map([["u1", "m1"], ["u2", "m2"], ["u5", "m2"]]),
      (_key, fallback) => fallback,
      600
    );
    expect(chapters.map((c) => [c.seconds, c.title])).toEqual([[0, "Cold open"], [20, "Why it matters"], [300, "What it earned"]]);
  });
});

describe("captions", () => {
  it("writes SRT cues from the final timeline", () => {
    expect(srtTime(3723.456)).toBe("01:02:03,456");
    const srt = buildSrt([
      { w: "Hello", s: 0, e: 0.4 },
      { w: "world.", s: 0.5, e: 0.9 },
      { w: "Next", s: 2, e: 2.3 }
    ]);
    expect(srt).toBe("1\n00:00:00,000 --> 00:00:00,900\nHello world.\n\n2\n00:00:02,000 --> 00:00:02,300\nNext\n");
  });
});

describe("description and titles", () => {
  const copy: StoryCopy = {
    titles: [
      { style: "curiosity", title: "What an AI Agent Did at 3am" },
      { style: "outcome", title: "My App Made $3,146 While I Coded" },
      { style: "contrarian", title: "Vibe Coding Is Not Lazy" },
      { style: "number", title: "4 Hours of Building in 10 Minutes" },
      { style: "direct", title: "Building CoLateral Live" }
    ],
    recommended: 1,
    recommendedReason: "Outcome plus a real number",
    hookSentence: "The build broke ten minutes before the sale landed.",
    arc: "Day 61 starts with a broken release.",
    takeaways: ["Ship small", "Watch the logs", "Sell before it is perfect"],
    hashtags: ["vibecoding", "#buildinpublic", "#ai"],
    tags: ["vibe coding"],
    chapterTitles: {},
    thumbnails: []
  };

  it("puts the hook first, then the arc, chapters, takeaways, CTA and hashtags last", () => {
    const text = buildDescription(copy, [
      { seconds: 0, title: "Cold open" },
      { seconds: 30, title: "The broken release" },
      { seconds: 200, title: "What it earned" }
    ]);
    const lines = text.split("\n");
    expect(lines[0]).toBe(copy.hookSentence);
    expect(text).toContain("00:00 Cold open\n00:30 The broken release\n03:20 What it earned");
    expect(text).toContain("- Ship small");
    expect(text).toContain("[ADD LINK]");
    expect(lines[lines.length - 1]).toBe("#vibecoding #buildinpublic #ai");
  });

  it("requires five titles under 60 characters in five styles", () => {
    expect(validateTitles(copy.titles)).toEqual([]);
    expect(validateTitles([{ style: "direct", title: "x".repeat(61) }]).length).toBeGreaterThan(0);
    expect(fitTitle("This Title Is Far Too Long To Fit Inside The Sixty Character Limit Ok").length).toBeLessThan(60);
  });
});

describe("privacy guard", () => {
  it("only ever builds a private status", () => {
    expect(storyStatus().privacyStatus).toBe(STORY_PRIVACY);
    const body = storyVideoBody({ title: "t", description: "d", tags: [], categoryId: "28", language: "en", madeForKids: false });
    expect(body.status.privacyStatus).toBe("private");
  });

  it.each(["public", "unlisted", undefined, "PRIVATE"])("refuses to send privacyStatus %s", (privacyStatus) => {
    expect(() => assertPrivate({ status: { privacyStatus, selfDeclaredMadeForKids: false } })).toThrow(PrivacyGuardError);
  });

  it("refuses a scheduled go-live", () => {
    expect(() => assertPrivate({ status: { privacyStatus: "private", publishAt: "2030-01-01T00:00:00Z" } })).toThrow(PrivacyGuardError);
  });

  it("sends private in the actual upload request and resumes after a network failure", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await mkdtemp(path.join(os.tmpdir(), "story-upload-"));
    const file = path.join(dir, "final.mp4");
    await writeFile(file, Buffer.alloc(1000, 1));
    const sent: string[] = [];
    let chunkCalls = 0;
    const fetcher = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (String(url).includes("uploadType=resumable")) {
        sent.push(String(init?.body));
        return new Response("", { status: 200, headers: { location: "https://upload/session" } });
      }
      if (headers["Content-Range"] === "bytes */1000") return new Response("", { status: 308, headers: { range: "bytes=0-499" } });
      chunkCalls++;
      if (chunkCalls === 1) throw new TypeError("fetch failed");
      expect(headers["Content-Range"]).toBe("bytes 500-999/1000");
      return new Response(JSON.stringify({ id: "vid123" }), { status: 200 });
    }) as typeof fetch;
    const result = await uploadStoryVideo({
      file,
      title: "[DRAFT] t",
      description: "d",
      tags: ["a"],
      categoryId: "28",
      language: "en",
      madeForKids: false,
      accessToken: async () => "token",
      fetcher,
      sleep: async () => undefined
    });
    expect(result.videoId).toBe("vid123");
    expect(JSON.parse(sent[0]).status.privacyStatus).toBe("private");
  });
});

describe("render graph", () => {
  const segment = (id: string, inPoint: number, out: number, extra: Partial<EdlSegment> = {}): EdlSegment => ({
    id,
    unitId: id,
    section: "development",
    source: "s.mp4",
    in: inPoint,
    out,
    timelineIn: 0,
    timelineOut: 0,
    zoom: 1,
    zoomTo: 1,
    anchorX: 0.5,
    anchorY: 0.5,
    transition: "jump",
    audioLeadSec: 0,
    enabled: true,
    reason: "r",
    audioScore: 0.5,
    visualScore: 0.5,
    scores: scores(0.5),
    ...extra
  });

  it("splits chunks at J-cuts and backward jumps and keeps video length equal to audio length", () => {
    const edl = {
      version: 1 as const,
      source: "s.mp4",
      fps: 30,
      width: 1920,
      height: 1080,
      runtimeSec: 0,
      segments: [
        segment("a", 100, 102),
        segment("b", 103, 105),
        segment("c", 50, 52, { transition: "j-cut", audioLeadSec: 0.3 }),
        segment("d", 10, 12, { transition: "cut" })
      ]
    };
    const chunks = planChunks(edl, 1000);
    expect(chunks.map((chunk) => chunk.segments.map((s) => s.id))).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(chunks[1].lead).toBeCloseTo(0.3);
    const graph = videoAssembly(chunks);
    const lengths = [...graph.matchAll(/trim=start=([\d.]+):end=([\d.]+)/g)].map((m) => Number(m[2]) - Number(m[1]));
    expect(lengths.reduce((a, b) => a + b, 0)).toBeCloseTo(4 + 2 + 2, 3);
    expect(chunkFilter(chunks[0], 1920, 1080, 30)).toContain("acrossfade=d=0.015");
  });

  it("uses a frame-centred crop for punch-ins and zoompan only for push-ins", () => {
    expect(zoomFilter(segment("a", 0, 2, { zoom: 1.1, zoomTo: 1.1 }), 1920, 1080, 30)).toBe(
      "crop=1744:980:88:50,scale=1920:1080:flags=lanczos+accurate_rnd+full_chroma_int,setsar=1"
    );
    expect(zoomFilter(segment("a", 0, 4, { zoom: 1, zoomTo: 1.08 }), 1920, 1080, 30)).toContain("zoompan=");
    expect(zoomFilter(segment("a", 0, 2), 1920, 1080, 30)).toBe("setsar=1");
  });
});

describe("fewer cuts", () => {
  it("plays a short breath instead of cutting it, but never merges over a removed filler", () => {
    const list: Word[] = [
      { w: "one", s: 0, e: 0.4 },
      { w: "two", s: 0.8, e: 1.2 },
      { w: "um", s: 1.3, e: 1.5 },
      { w: "three", s: 1.6, e: 2 }
    ];
    const base = { unitId: "u", section: "setup" as const, source: "", timelineIn: 0, timelineOut: 0, zoom: 1, zoomTo: 1, anchorX: 0.5, anchorY: 0.5, audioLeadSec: 0, enabled: true, reason: "r", audioScore: 0.5, visualScore: 0.5, scores: scores(0.5) };
    const merged = mergeBreaths(
      [
        { ...base, id: "a", in: 0, out: 0.45, transition: "cut" },
        { ...base, id: "b", in: 0.75, out: 1.25, transition: "jump" },
        { ...base, id: "c", in: 1.55, out: 2, transition: "jump" }
      ],
      list,
      new Map([[2, "filler"]])
    );
    expect(merged.map((segment) => [segment.in, segment.out])).toEqual([[0, 1.25], [1.55, 2]]);
    expect(merged[1].timelineIn).toBeCloseTo(1.25);
  });
});

describe("shot plan", () => {
  const pane = { x0: 0.69375, y0: 0.0083, x1: 1, y1: 0.3287 };
  const make = (id: string, text: string, timelineIn: number, duration: number, transition: EdlSegment["transition"] = "jump"): EdlSegment => ({
    id,
    unitId: id,
    section: "development",
    source: "",
    in: timelineIn + 100,
    out: timelineIn + 100 + duration,
    timelineIn,
    timelineOut: timelineIn + duration,
    zoom: 1,
    zoomTo: 1,
    anchorX: 0.5,
    anchorY: 0.5,
    transition,
    audioLeadSec: 0,
    enabled: true,
    reason: "development: steady",
    audioScore: 0.5,
    visualScore: 0.5,
    scores: scores(0.5)
  });

  it("frames the camera box exactly for a reaction", () => {
    const framing = faceFraming(pane, 1920, 1080);
    expect(framing.zoom).toBeGreaterThan(3);
    expect(framing.x).toBeCloseTo(0.847, 2);
  });

  it("holds a framing for at least five seconds and cuts to the camera only briefly", () => {
    const segments = [
      make("s1", "So we started the stream today", 0, 3, "cut"),
      make("s2", "and look at this website right here", 3, 3),
      make("s3", "the pricing section is right here", 6, 3),
      make("s4", "Holy crap, I got a reset!", 9, 2),
      make("s5", "then we kept talking about the plan", 11, 3),
      make("s6", "and more talking about the plan", 14, 3)
    ];
    const units = new Map(segments.map((segment) => [segment.id, { ...unit(segment.id, 0, 1, segment.id === "s4" ? "Holy crap, I got a reset!" : segment.id === "s2" || segment.id === "s3" ? "look at this website right here" : "we kept talking about the plan", 0.5), audio: { clarity: 0.8, energy: 0.9, paceWpm: 160, fillerRate: 0 } }]));
    const focus = new Map([["s2", { x: 0.4, y: 0.5, share: 0.5, motion: 1 }], ["s3", { x: 0.4, y: 0.5, share: 0.5, motion: 1 }]]);
    const shots = planShots({ segments, units, focus, pane, width: 1920, height: 1080 });
    expect(shots.map((segment) => segment.shot)).toEqual(["wide", "wide", "screen", "face", "wide", "wide"]);
    expect(shots[2].zoom).toBe(SCREEN_ZOOM);
    expect(summarizeShots(shots).face).toBe(1);
  });
});

describe("hook captions", () => {
  it("writes bold yellow lower-third lines a few words at a time", () => {
    const ass = hookCaptionsAss(
      [
        { w: "Disaster", s: 0, e: 0.4 },
        { w: "stream", s: 0.4, e: 0.7 },
        { w: "is", s: 0.7, e: 0.8 },
        { w: "in", s: 0.8, e: 0.9 }
      ],
      1920,
      1080
    );
    expect(ass).toContain("Style: Hook,Arial Black,92,&H0000E5FF");
    expect(ass).toContain(",-1,0,0,0,");
    expect(ass).toContain("DISASTER STREAM IS");
    expect(ass.split("Dialogue:").length - 1).toBe(2);
  });
});
