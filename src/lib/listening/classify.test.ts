import { describe, expect, it, vi } from "vitest";
import {
  CLASSIFY_BATCH_SIZE,
  MAX_CLASSIFIED_PER_SCAN,
  classifyHits,
  heuristicClassify,
  parseClassifyReply
} from "@/lib/listening/classify";
import { DEFAULT_KEYWORD_GROUPS, type ListeningHit } from "@/lib/listening/model";
import { HIGH_LEAD_SCORE } from "@/lib/listening/leads";
import type { AiRequest, AiResult } from "@/lib/ai/provider";

const NOW = new Date("2026-10-12T12:00:00.000Z");

function hit(overrides: Partial<ListeningHit> = {}): ListeningHit {
  return {
    source: "reddit",
    title: "r/StructuralEngineering: something",
    url: `https://www.reddit.com/r/x/comments/${Math.random().toString(36).slice(2)}/`,
    author: "dana",
    createdAt: "2026-10-12T09:00:00.000Z",
    excerpt: "",
    matchedTerms: [],
    ...overrides
  };
}

const asking = hit({
  title: "Anyone know a structural engineering AI that can check a Revit model?",
  excerpt: "Looking for a tool that sanity checks beam sizes. Has anyone tried one? Drowning in RFIs.",
  matchedTerms: ["structural engineering AI", "Revit"]
});

type RunAi = (request: AiRequest) => Promise<AiResult | null>;

function numbersIn(request: AiRequest): number[] {
  const text = request.messages.map((message) => message.content).join("\n");
  return [...text.matchAll(/^\[(\d+)\]/gm)].map((match) => Number(match[1]));
}

function reply(items: unknown): AiResult {
  return { text: `\`\`\`json\n${JSON.stringify(items)}\n\`\`\``, refused: false };
}

const allLeads: RunAi = async (request) =>
  reply(numbersIn(request).map((n) => ({ n, category: "lead", sentiment: 0.2, score: 88, reason: "Asks for a tool" })));

describe("the keyword heuristic", () => {
  it("calls a question about the problem we solve a high-scoring lead", () => {
    const result = heuristicClassify(asking, DEFAULT_KEYWORD_GROUPS, NOW);
    expect(result.category).toBe("lead");
    expect(result.score).toBeGreaterThanOrEqual(HIGH_LEAD_SCORE);
    expect(result.classifiedBy).toBe("heuristic");
    expect(result.reason).not.toBe("");
  });

  it("treats someone asking for an alternative to a competitor as a lead, and a plain mention of one as a competitor hit", () => {
    const question = heuristicClassify(
      hit({ title: "Is there an alternative to ETABS for small firms?", excerpt: "ETABS pricing is crazy, what do you use instead?", matchedTerms: ["ETABS"] }),
      DEFAULT_KEYWORD_GROUPS,
      NOW
    );
    expect(question.category).toBe("lead");

    const statement = heuristicClassify(
      hit({ title: "ETABS 22 released", excerpt: "CSI shipped a new version of ETABS this week with updated steel design codes.", matchedTerms: ["ETABS"] }),
      DEFAULT_KEYWORD_GROUPS,
      NOW
    );
    expect(statement.category).toBe("competitor");
    expect(statement.score).toBeLessThan(HIGH_LEAD_SCORE);
  });

  it("treats a statement about our own name as a mention", () => {
    const result = heuristicClassify(
      hit({ title: "Trying CoLateral AI this week", excerpt: "Set up CoLateral AI on my laptop yesterday.", matchedTerms: ["CoLateral AI"] }),
      DEFAULT_KEYWORD_GROUPS,
      NOW
    );
    expect(result.category).toBe("mention");
    expect(result.score).toBeLessThan(HIGH_LEAD_SCORE);
  });

  it("throws job ads and promotions out as noise", () => {
    const result = heuristicClassify(
      hit({ title: "We're hiring: Revit technician, apply now", excerpt: "Is this you? Apply now!", matchedTerms: ["Revit"] }),
      DEFAULT_KEYWORD_GROUPS,
      NOW
    );
    expect(result.category).toBe("noise");
    expect(result.score).toBeLessThan(20);
  });

  it("scores the mood of the text between -1 and 1", () => {
    const glad = heuristicClassify(hit({ excerpt: "I love how fast RISA is, great tool, amazing support", matchedTerms: ["RISA"] }), DEFAULT_KEYWORD_GROUPS, NOW);
    const angry = heuristicClassify(hit({ excerpt: "SAP2000 keeps crashing, terrible and frustrating, I hate it", matchedTerms: ["SAP2000"] }), DEFAULT_KEYWORD_GROUPS, NOW);
    const flat = heuristicClassify(hit({ excerpt: "Tekla has a new release notes page", matchedTerms: ["Tekla"] }), DEFAULT_KEYWORD_GROUPS, NOW);
    expect(glad.sentiment).toBeGreaterThan(0);
    expect(glad.sentiment).toBeLessThanOrEqual(1);
    expect(angry.sentiment).toBeLessThan(0);
    expect(angry.sentiment).toBeGreaterThanOrEqual(-1);
    expect(flat.sentiment).toBe(0);
  });
});

describe("parsing the model's reply", () => {
  it("reads a fenced JSON array and clamps the numbers", () => {
    const parsed = parseClassifyReply(
      reply([{ n: 1, category: "lead", sentiment: 4, score: 140, reason: "x".repeat(400) }]).text
    );
    expect(parsed.get(1)).toMatchObject({ category: "lead", sentiment: 1, score: 100, classifiedBy: "ai" });
    expect(parsed.get(1)!.reason.length).toBeLessThanOrEqual(160);
  });

  it("drops entries it cannot trust and survives prose around the array", () => {
    const parsed = parseClassifyReply(
      `Sure! [{"n":1,"category":"spam","sentiment":0,"score":5,"reason":"?"},{"n":2,"category":"noise","sentiment":-0.5,"score":3,"reason":"ad"}] Hope that helps.`
    );
    expect([...parsed.keys()]).toEqual([2]);
  });

  it("returns nothing for text that is not JSON", () => {
    expect(parseClassifyReply("I cannot help with that.").size).toBe(0);
    expect(parseClassifyReply("[not json").size).toBe(0);
  });
});

describe("classifying with the model", () => {
  it("sends the hits in small batches and uses the model's answers", async () => {
    const runAi = vi.fn(allLeads);
    const hits = Array.from({ length: 17 }, () => hit({ matchedTerms: ["Revit"] }));
    const out = await classifyHits(hits, DEFAULT_KEYWORD_GROUPS, { runAi, now: () => NOW });

    expect(runAi).toHaveBeenCalledTimes(3);
    expect(runAi.mock.calls.map(([request]) => numbersIn(request).length)).toEqual([CLASSIFY_BATCH_SIZE, CLASSIFY_BATCH_SIZE, 1]);
    expect(out.hits).toHaveLength(17);
    expect(out.hits.every((entry) => entry.category === "lead" && entry.score === 88 && entry.classifiedBy === "ai")).toBe(true);
    expect(out).toMatchObject({ ai: 17, heuristic: 0 });
  });

  it("tells the model the posts are untrusted data and asks for JSON only", async () => {
    const runAi = vi.fn(allLeads);
    await classifyHits([asking], DEFAULT_KEYWORD_GROUPS, { runAi, now: () => NOW });
    const request = runAi.mock.calls[0][0];
    expect(request.system).toMatch(/untrusted/i);
    expect(request.system).toMatch(/JSON/);
    expect(request.messages[0].content).toContain("structural engineering AI that can check a Revit model");
  });

  it("falls back to the keyword heuristic when no model answers, and asks only once", async () => {
    const runAi = vi.fn(async () => null);
    const hits = [asking, ...Array.from({ length: 12 }, () => hit({ matchedTerms: ["Revit"] }))];
    const out = await classifyHits(hits, DEFAULT_KEYWORD_GROUPS, { runAi, now: () => NOW });

    expect(runAi).toHaveBeenCalledTimes(1);
    expect(out.hits).toHaveLength(13);
    expect(out.hits.every((entry) => entry.classifiedBy === "heuristic")).toBe(true);
    expect(out.hits[0].category).toBe("lead");
    expect(out).toMatchObject({ ai: 0, heuristic: 13 });
  });

  it("falls back when the model throws", async () => {
    const runAi = vi.fn(async () => {
      throw new Error("network down");
    });
    const out = await classifyHits([asking], DEFAULT_KEYWORD_GROUPS, { runAi, now: () => NOW });
    expect(out.hits[0].classifiedBy).toBe("heuristic");
    expect(out.hits[0].category).toBe("lead");
  });

  it("uses the heuristic for a batch whose reply is unreadable, and the model for the next one", async () => {
    let call = 0;
    const runAi = vi.fn(async (request: AiRequest) => {
      call += 1;
      return call === 1 ? ({ text: "Sorry, I can't classify these.", refused: false } as AiResult) : allLeads(request);
    });
    const hits = Array.from({ length: CLASSIFY_BATCH_SIZE + 2 }, () => hit({ matchedTerms: ["Revit"] }));
    const out = await classifyHits(hits, DEFAULT_KEYWORD_GROUPS, { runAi, now: () => NOW });

    expect(runAi).toHaveBeenCalledTimes(2);
    expect(out.hits.map((entry) => entry.classifiedBy)).toEqual([
      ...Array(CLASSIFY_BATCH_SIZE).fill("heuristic"),
      "ai",
      "ai"
    ]);
  });

  it("fills in only the entries the model left out", async () => {
    const runAi = vi.fn(async () => reply([{ n: 1, category: "noise", sentiment: 0, score: 2, reason: "ad" }, { n: 3, category: "lead", sentiment: 0, score: 91, reason: "asks" }]));
    const out = await classifyHits([hit({ matchedTerms: ["Revit"] }), asking, hit({ matchedTerms: ["Revit"] })], DEFAULT_KEYWORD_GROUPS, { runAi, now: () => NOW });

    expect(out.hits.map((entry) => entry.classifiedBy)).toEqual(["ai", "heuristic", "ai"]);
    expect(out.hits[0].category).toBe("noise");
    expect(out.hits[1].category).toBe("lead");
    expect(out).toMatchObject({ ai: 2, heuristic: 1 });
  });

  it("caps how many hits one scan sends to the model", async () => {
    const runAi = vi.fn(allLeads);
    const hits = Array.from({ length: MAX_CLASSIFIED_PER_SCAN + 10 }, () => hit({ matchedTerms: ["Revit"] }));
    const out = await classifyHits(hits, DEFAULT_KEYWORD_GROUPS, { runAi, now: () => NOW });

    expect(runAi).toHaveBeenCalledTimes(Math.ceil(MAX_CLASSIFIED_PER_SCAN / CLASSIFY_BATCH_SIZE));
    expect(out).toMatchObject({ ai: MAX_CLASSIFIED_PER_SCAN, heuristic: 10 });
    expect(out.hits).toHaveLength(MAX_CLASSIFIED_PER_SCAN + 10);
  });

  it("does nothing for an empty list", async () => {
    const runAi = vi.fn(allLeads);
    const out = await classifyHits([], DEFAULT_KEYWORD_GROUPS, { runAi, now: () => NOW });
    expect(out.hits).toEqual([]);
    expect(runAi).not.toHaveBeenCalled();
  });
});
