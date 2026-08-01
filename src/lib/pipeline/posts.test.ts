import { describe, expect, it } from "vitest";
import { buildPipelinePostsPrompt, fallbackPipelinePosts, parsePipelinePosts } from "@/lib/pipeline/posts";

const input = {
  streamTitle: "Building CoLateral Live",
  transcriptText: "Today we wired the beam checker into the agent loop and it actually held up. ".repeat(10),
  clipHighlights: [
    { title: "Claude Fixed My Worst Bug Live", quote: "okay this is actually insane" },
    { title: "Why Vibe Coding Beats Planning" }
  ]
};

describe("buildPipelinePostsPrompt", () => {
  it("includes the stream title, highlights, and transcript excerpt", () => {
    const prompt = buildPipelinePostsPrompt(input);
    expect(prompt).toContain("Building CoLateral Live");
    expect(prompt).toContain("Claude Fixed My Worst Bug Live");
    expect(prompt).toContain('(opens with: "okay this is actually insane")');
    expect(prompt).toContain("beam checker");
    expect(prompt).toContain('"platform"');
  });

  it("omits the transcript block when there is no transcript", () => {
    const prompt = buildPipelinePostsPrompt({ ...input, transcriptText: "" });
    expect(prompt).not.toContain("Transcript excerpt");
  });
});

describe("parsePipelinePosts", () => {
  it("reads a fenced JSON array and keeps only valid platforms", () => {
    const text = [
      "Here you go:",
      "```json",
      JSON.stringify([
        { platform: "x", text: "Shipping the beam checker live taught me more than a week of planning." },
        { platform: "tiktok", text: "wrong platform" },
        { platform: "threads", text: "" },
        { platform: "facebook", text: "Tonight's stream turned into a debugging masterclass." }
      ]),
      "```"
    ].join("\n");
    const posts = parsePipelinePosts(text);
    expect(posts.map((post) => post.platform)).toEqual(["x", "facebook"]);
    expect(posts[0].id).toBe("post-1");
  });

  it("returns empty on junk output", () => {
    expect(parsePipelinePosts("no json here")).toEqual([]);
    expect(parsePipelinePosts('{"posts": true}')).toEqual([]);
  });
});

describe("fallbackPipelinePosts", () => {
  it("builds announcement posts from the clip titles, never fragments", () => {
    const posts = fallbackPipelinePosts(input);
    expect(posts.length).toBeGreaterThanOrEqual(2);
    expect(posts[0].platform).toBe("x");
    expect(posts[0].text).toContain("Claude Fixed My Worst Bug Live");
    expect(posts.at(-1)?.platform).toBe("facebook");
    for (const post of posts) {
      expect(post.text).not.toContain("#");
      expect(post.text.trim().length).toBeGreaterThan(20);
    }
  });

  it("still produces posts with no highlights", () => {
    const posts = fallbackPipelinePosts({ ...input, clipHighlights: [] });
    expect(posts.length).toBeGreaterThanOrEqual(2);
    expect(posts[0].text).toContain("Building CoLateral Live");
  });
});
