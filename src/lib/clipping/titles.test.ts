import { describe, expect, it } from "vitest";
import {
  CHANNEL_KEYWORDS,
  TITLE_STYLE_EXAMPLES,
  VIRAL_TITLE_SYSTEM_PROMPT,
  buildViralTitleUserPrompt,
  cleanViralTitle,
  parseViralTitles
} from "./titles";

describe("VIRAL_TITLE_SYSTEM_PROMPT", () => {
  it("carries the channel keywords and the style examples", () => {
    for (const keyword of ["AI", "vibe coding", "Claude", "ChatGPT", "business"]) {
      expect(CHANNEL_KEYWORDS).toContain(keyword);
      expect(VIRAL_TITLE_SYSTEM_PROMPT).toContain(keyword);
    }
    for (const example of TITLE_STYLE_EXAMPLES) {
      expect(VIRAL_TITLE_SYSTEM_PROMPT).toContain(example);
    }
    // The core rule: titles are complete phrases, never transcript fragments.
    expect(VIRAL_TITLE_SYSTEM_PROMPT.toLowerCase()).toContain("transcript fragment");
  });
});

describe("buildViralTitleUserPrompt", () => {
  it("lists every clip with its id and transcript and asks for JSON", () => {
    const prompt = buildViralTitleUserPrompt(
      [
        { id: "clip-1", transcript: "we generate new clips and then like" },
        { id: "clip-2", transcript: "the about page, the tools page" }
      ],
      { streamTitle: "Building CoLateral live", topic: "AI coding" }
    );
    expect(prompt).toContain("Clip clip-1:");
    expect(prompt).toContain("Clip clip-2:");
    expect(prompt).toContain("we generate new clips and then like");
    expect(prompt).toContain("Building CoLateral live");
    expect(prompt).toContain("AI coding");
    expect(prompt).toContain("JSON array");
  });

  it("caps very long transcripts so the prompt stays bounded", () => {
    const prompt = buildViralTitleUserPrompt([{ id: "clip-1", transcript: "word ".repeat(2000) }]);
    const body = prompt.slice(prompt.indexOf("Clip clip-1:"));
    expect(body.length).toBeLessThan(1000);
  });
});

describe("cleanViralTitle", () => {
  it("strips wrapping quotes, hashtags and emoji", () => {
    expect(cleanViralTitle('"Why I Let AI Write All My Code"')).toBe("Why I Let AI Write All My Code");
    expect(cleanViralTitle("Vibe Coding Wins 🚀 #ai #shorts")).toBe("Vibe Coding Wins");
  });

  it("rejects fragments too thin or too long to be a real title", () => {
    expect(cleanViralTitle("slow. How")).toBe("");
    expect(cleanViralTitle("word ".repeat(40))).toBe("");
  });
});

describe("parseViralTitles", () => {
  it("reads an id->title map from a plain JSON reply", () => {
    const titles = parseViralTitles(
      '[{"id":"clip-1","title":"Why I Let AI Write All My Code"},{"id":"clip-2","title":"ChatGPT vs Claude for Real Business Work"}]'
    );
    expect(titles.get("clip-1")).toBe("Why I Let AI Write All My Code");
    expect(titles.get("clip-2")).toBe("ChatGPT vs Claude for Real Business Work");
  });

  it("tolerates code fences and surrounding prose", () => {
    const titles = parseViralTitles(
      'Here you go:\n```json\n[{"id":"clip-1","title":"Building a Startup Live With AI Agents"}]\n```'
    );
    expect(titles.get("clip-1")).toBe("Building a Startup Live With AI Agents");
  });

  it("drops entries with missing ids or unusable titles", () => {
    const titles = parseViralTitles('[{"id":"clip-1","title":"ok"},{"title":"No Id Here At All"},{"id":"clip-3"}]');
    expect(titles.size).toBe(0);
  });

  it("returns an empty map on an unparseable reply", () => {
    expect(parseViralTitles("sorry, no can do").size).toBe(0);
  });
});
