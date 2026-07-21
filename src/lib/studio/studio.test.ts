import { describe, expect, it } from "vitest";
import { buildIdeaResearchPrompt, libraryIdeas, parseIdeaResearch, toIdeaRecords } from "@/lib/studio/ideas";
import { buildScriptPrompt, parseScript, scriptFullText, skeletonScript } from "@/lib/studio/scripts";
import { buildCarouselPrompt, fallbackCarousel, parseCarousel, toCarouselRecord } from "@/lib/studio/carousel";
import { DEFAULT_SCRIPT_FRAMEWORK } from "@/lib/storage/schemas";

describe("idea research", () => {
  it("parses a fenced reply and normalizes fields", () => {
    const reply = [
      "```json",
      JSON.stringify({
        ideas: [
          {
            title: "How I Vibe Code a SaaS",
            angle: "Real build.",
            format: "weird",
            primaryKeyword: "vibe coding",
            keywords: ["vibe coding", 42, "claude"],
            searchIntent: "tutorial",
            competition: "low",
            score: 250,
            rationale: "Strong fit."
          },
          { title: "" }
        ]
      }),
      "```"
    ].join("\n");
    const ideas = parseIdeaResearch(reply);
    expect(ideas).toHaveLength(1);
    expect(ideas[0].format).toBe("longform"); // unknown value normalized
    expect(ideas[0].keywords).toEqual(["vibe coding", "claude"]);
    expect(ideas[0].score).toBe(100); // clamped
  });

  it("returns [] on junk", () => {
    expect(parseIdeaResearch("no json here")).toEqual([]);
  });

  it("stamps records with ids and suggested status", () => {
    const records = toIdeaRecords(libraryIdeas("AI agents"), "AI agents", "library");
    expect(records.length).toBeGreaterThan(3);
    expect(records[0].status).toBe("suggested");
    expect(records[0].seedKeyword).toBe("AI agents");
    expect(records[0].id).toMatch(/^idea-/);
  });

  it("feeds outliers and existing titles into the prompt", () => {
    const prompt = buildIdeaResearchPrompt({
      seed: "claude code",
      outlierTitles: ["Big Outlier Video"],
      existingTitles: ["Already Have This"]
    });
    expect(prompt).toContain("claude code");
    expect(prompt).toContain("Big Outlier Video");
    expect(prompt).toContain("Already Have This");
  });
});

describe("script generation", () => {
  it("parses sections and keys production kit to section ids", () => {
    const reply = JSON.stringify({
      sections: [
        { name: "Hook", purpose: "grab", content: "I built a SaaS in a weekend." },
        { name: "Payoff", purpose: "deliver", content: "Here's the result." }
      ],
      graphics: [
        { section: "hook", kind: "screen-recording", description: "Show the finished app" },
        { section: "nowhere", kind: "diagram", description: "Architecture sketch" }
      ],
      sfx: [{ section: "Payoff", cue: "after 'the result'", sound: "Vine boom" }]
    });
    const parsed = parseScript(reply);
    expect(parsed).not.toBeNull();
    expect(parsed!.sections).toHaveLength(2);
    // Graphic resolved case-insensitively to the Hook section's id.
    expect(parsed!.graphics[0].sectionId).toBe(parsed!.sections[0].id);
    // Unknown section name degrades to "" (whole video), not a crash.
    expect(parsed!.graphics[1].sectionId).toBe("");
    expect(parsed!.sfx[0].sectionId).toBe(parsed!.sections[1].id);
    expect(parsed!.sfx[0].status).toBe("suggested");
  });

  it("builds a skeleton from the framework headings", () => {
    const skeleton = skeletonScript(DEFAULT_SCRIPT_FRAMEWORK);
    expect(skeleton.sections.map((s) => s.name)).toContain("Hook");
    expect(skeleton.sections.some((s) => /voice rules/i.test(s.name))).toBe(false);
  });

  it("renders the full text with section headings", () => {
    const text = scriptFullText({
      title: "My Video",
      sections: [{ id: "a", name: "Hook", purpose: "", content: "Line one." }]
    });
    expect(text).toContain("My Video");
    expect(text).toContain("## Hook");
    expect(text).toContain("Line one.");
  });

  it("includes the framework and target length in the prompt", () => {
    const prompt = buildScriptPrompt({ framework: "MY FRAMEWORK", title: "T", targetMinutes: 10 });
    expect(prompt).toContain("MY FRAMEWORK");
    expect(prompt).toContain("10 minutes");
  });
});

describe("carousel generation", () => {
  it("parses slides and drops empties", () => {
    const reply = JSON.stringify({
      title: "AI Lessons",
      slides: [
        { heading: "Hook", body: "" },
        { heading: "", body: "" },
        { heading: "Point", body: "Something real." }
      ]
    });
    const parsed = parseCarousel(reply);
    expect(parsed).not.toBeNull();
    expect(parsed!.slides).toHaveLength(2);
    expect(parsed!.title).toBe("AI Lessons");
  });

  it("falls back to sentence-split slides bracketed by hook and CTA", () => {
    const fallback = fallbackCarousel({
      title: "My Video",
      sourceText: "This is the first long sentence of the video. Here is another meaningful sentence to use. And one more for good measure here.",
      slideCount: 5
    });
    expect(fallback.slides[0].heading).toBe("My Video");
    expect(fallback.slides[fallback.slides.length - 1].heading).toMatch(/follow/i);
  });

  it("stamps slide ids on the persisted record", () => {
    const record = toCarouselRecord({
      title: "T",
      slides: [{ heading: "H", body: "B" }],
      sourceType: "custom"
    });
    expect(record.slides[0].id).toMatch(/^slide-/);
    expect(record.id).toMatch(/^carousel-/);
  });

  it("caps source text in the prompt", () => {
    const prompt = buildCarouselPrompt({ title: "T", sourceText: "x".repeat(20000), slideCount: 8 });
    expect(prompt.length).toBeLessThan(12000);
  });
});
