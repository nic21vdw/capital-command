import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHANNEL_KEYWORDS,
  TITLE_STYLE_EXAMPLES,
  VIRAL_TITLE_SYSTEM_PROMPT,
  buildViralTitleUserPrompt,
  cleanViralTitle,
  generateViralTitles,
  parseViralTitles
} from "./titles";

const ai = vi.hoisted(() => ({
  configured: true,
  replies: [] as string[],
  prompts: [] as string[]
}));

vi.mock("@/lib/ai", () => ({
  aiConfigured: () => ai.configured,
  runAi: async ({ messages }: { messages: Array<{ content: string }> }) => {
    ai.prompts.push(messages[0].content);
    const text = ai.replies.shift();
    return text === undefined ? null : { text, refused: false };
  }
}));

const reply = (entries: Array<[string, string]>) =>
  JSON.stringify(entries.map(([id, title]) => ({ id, title })));

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

describe("generateViralTitles", () => {
  beforeEach(() => {
    ai.configured = true;
    ai.replies = [];
    ai.prompts = [];
  });

  const clip = { id: "clip-1", transcript: "so yeah we started on this grind today" };

  it("keeps a title that clears the quality gate, in one call", async () => {
    ai.replies = [reply([["clip-1", "Why I Use Opus 5 Despite the Cost"]])];
    const titles = await generateViralTitles([clip]);
    expect(titles?.get("clip-1")).toBe("Why I Use Opus 5 Despite the Cost");
    expect(ai.prompts).toHaveLength(1);
  });

  it("asks again — with the rejected title and the reason — instead of falling through", async () => {
    ai.replies = [
      reply([["clip-1", "Have We've Started on This Grind"]]),
      reply([["clip-1", "Claude Ships My Whole App While I Sleep"]])
    ];
    const titles = await generateViralTitles([clip]);
    expect(titles?.get("clip-1")).toBe("Claude Ships My Whole App While I Sleep");
    expect(ai.prompts).toHaveLength(2);
    expect(ai.prompts[1]).toContain("Have We've Started on This Grind");
    expect(ai.prompts[1].toLowerCase()).toContain("auxiliary");
  });

  it("gives up after the bounded retries rather than handing back sludge", async () => {
    ai.replies = [
      reply([["clip-1", "Let's Get Started on the Grind"]]),
      reply([["clip-1", "What Is Up My Man Today"]]),
      reply([["clip-1", "Inside Your Local Grind Session Today For"]])
    ];
    expect(await generateViralTitles([clip])).toBeNull();
    expect(ai.prompts).toHaveLength(3);
  });

  it("stops retrying the clips that already have a good title", async () => {
    ai.replies = [
      reply([
        ["clip-1", "Claude Writes My Entire Landing Page"],
        ["clip-2", "Thank, Max and Tool"]
      ]),
      reply([["clip-2", "Cursor Finally Beat My Old Workflow"]])
    ];
    const titles = await generateViralTitles([clip, { id: "clip-2", transcript: "thank max and tool" }]);
    expect(titles?.get("clip-1")).toBe("Claude Writes My Entire Landing Page");
    expect(titles?.get("clip-2")).toBe("Cursor Finally Beat My Old Workflow");
    expect(ai.prompts[1]).toContain("Clip clip-2:");
    expect(ai.prompts[1]).not.toContain("Clip clip-1:");
  });

  it("returns null when the AI is not configured at all", async () => {
    ai.configured = false;
    expect(await generateViralTitles([clip])).toBeNull();
    expect(ai.prompts).toHaveLength(0);
  });
});
