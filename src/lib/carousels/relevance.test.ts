import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRelevancePrompt,
  frameRelevanceConfigured,
  MIN_FRAME_RELEVANCE,
  parseRelevance,
  rateFrame
} from "@/lib/carousels/relevance";

const key = process.env.FAL_KEY;

afterEach(() => {
  if (key === undefined) delete process.env.FAL_KEY;
  else process.env.FAL_KEY = key;
  vi.unstubAllGlobals();
});

describe("frameRelevanceConfigured", () => {
  it("is off without a credential, so the deck is still illustrated on looks alone", () => {
    delete process.env.FAL_KEY;
    expect(frameRelevanceConfigured()).toBe(false);
  });

  it("is on once there is one", () => {
    process.env.FAL_KEY = "test-key";
    expect(frameRelevanceConfigured()).toBe(true);
  });
});

describe("buildRelevancePrompt", () => {
  it("puts the slide's own words in front of the model", () => {
    const prompt = buildRelevancePrompt({ heading: "Claude runs inside", body: "The agent terminal." });
    expect(prompt).toContain("Claude runs inside — The agent terminal.");
    expect(prompt).toContain("SCORE: <1-10>");
  });

  it("names the failures worth rejecting", () => {
    const prompt = buildRelevancePrompt({ heading: "Anything" });
    expect(prompt).toContain("crossfade");
    expect(prompt).toContain("mid-blink");
  });

  it("says a clean shot of the speaker passes when the words have nothing to show", () => {
    const prompt = buildRelevancePrompt({ heading: "Sleep is non-negotiable" });
    expect(prompt).toContain("SHOWS NOTHING → judge ONLY the picture's quality as a backdrop");
    expect(prompt).toContain("Do not mark it down for not illustrating the words");
    // Naming the product while stating a plan is not a claim about the picture.
    expect(prompt).toContain("is a plan, not a claim about what is on screen");
  });
});

describe("parseRelevance", () => {
  it("reads a bare number", () => {
    expect(parseRelevance("9")).toBe(9);
  });

  it("reads the score line out of a worked answer", () => {
    const reply = ["SEE: Warp with 5 panes", "NAMES: a transcript", "FOUND: no", "SCORE: 3"].join("\n");
    expect(parseRelevance(reply)).toBe(3);
  });

  it("takes the last number when the model ignored the format", () => {
    expect(parseRelevance("It shows 5 terminal panes, so I would say 4")).toBe(4);
  });

  it("clamps a nonsense rating into range", () => {
    expect(parseRelevance("47")).toBe(10);
  });

  it("gives nothing when there is no number", () => {
    expect(parseRelevance("hard to say")).toBeNull();
  });
});

describe("rateFrame", () => {
  it("does not call out when there is no credential", async () => {
    delete process.env.FAL_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await rateFrame({ slide: { heading: "A" }, jpeg: new Uint8Array([1]) })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the rating back", async () => {
    process.env.FAL_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ output: "9" }), { status: 200 }))
    );
    expect(await rateFrame({ slide: { heading: "A" }, jpeg: new Uint8Array([1]) })).toBe(9);
  });

  it("returns nothing when the endpoint fails, so the caller keeps its own pick", async () => {
    process.env.FAL_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    );
    expect(await rateFrame({ slide: { heading: "A" }, jpeg: new Uint8Array([1]) })).toBeNull();
  });

  it("returns nothing when the call throws rather than letting it escape", async () => {
    process.env.FAL_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    expect(await rateFrame({ slide: { heading: "A" }, jpeg: new Uint8Array([1]) })).toBeNull();
  });
});

describe("MIN_FRAME_RELEVANCE", () => {
  it("is the bar the deck is held to", () => {
    expect(MIN_FRAME_RELEVANCE).toBe(8);
  });
});
