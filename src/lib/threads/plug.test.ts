import { describe, expect, it } from "vitest";
import { threadsConfig, THREADS_TEXT_LIMIT, type ThreadsConfig } from "@/lib/threads/config";
import { mentionsColateral, plugReplyFor } from "@/lib/threads/plug";
import { threadsReplyUrl } from "@/lib/threads/reply-attribution";

function config(overrides: Partial<ThreadsConfig> = {}): ThreadsConfig {
  return {
    ...threadsConfig(),
    plugReplies: true,
    plugUrl: "https://colateralai.com",
    ...overrides
  };
}

function replyUrl(reply: string): URL {
  return new URL(reply.split("\n").at(-1)!);
}

const CONTEXT_CASES = [
  { text: "The IDE should fit the way you think.", angle: "workspace", subject: /workspace/i },
  { text: "A tiny workflow script saved a lot of clicking.", angle: "custom-tools", subject: /tools?/i },
  { text: "I gave the agents smaller tasks and clearer checks.", angle: "agents", subject: /agents?/i },
  { text: "Checking the Revit beam layout before the next review.", angle: "engineering", subject: /engineer/i },
  { text: "My YouTube thumbnails needed a simpler story.", angle: "marketing", subject: /content|marketing/i },
  { text: "The multiplayer game finally has a smoother lobby.", angle: "games", subject: /arcade|games?/i },
  { text: "Building in public means showing the awkward prototypes too.", angle: "build-in-public", subject: /build|project/i },
  { text: "A quiet walk does wonders for perspective.", angle: "general", subject: /workspace|project|building|working/i }
] as const;

describe("contextual CoLateral self-replies", () => {
  it.each(CONTEXT_CASES)("bridges a non-brand $angle post to the relevant part of the project", ({ text, angle, subject }) => {
    expect(mentionsColateral(text)).toBe(false);
    const reply = plugReplyFor(text, "2026-10-02:1:primary", config());
    expect(reply).toBeDefined();
    expect(reply).toContain("CoLateral");
    expect(reply).toMatch(subject);
    expect(reply).not.toContain(text);
    expect(replyUrl(reply!).hostname).toBe("colateralai.com");
    expect(replyUrl(reply!).searchParams.get("utm_content")).toBe(`autopilot-${angle}`);
    expect(reply!.length).toBeLessThanOrEqual(THREADS_TEXT_LIMIT);
  });

  it("still recognizes existing CoLateral spelling variations without requiring them for replies", () => {
    expect(mentionsColateral("Building CoLateral")).toBe(true);
    expect(mentionsColateral("co-lateral is my project")).toBe(true);
    expect(mentionsColateral("collateral damage")).toBe(false);
    expect(plugReplyFor("Building CoLateral tonight", "post-1", config())).toBeDefined();
  });

  it("chooses the specific subject when a post also mentions agents or the brand", () => {
    const reply = plugReplyFor("CoLateral agents reviewing a structural beam layout", "post-1", config());
    expect(replyUrl(reply!).searchParams.get("utm_content")).toBe("autopilot-engineering");
  });

  it("keeps an explicit agent workspace ahead of broad tool and agent keywords", () => {
    const reply = plugReplyFor("Agents and tools in the same workspace", "post-1", config());
    expect(replyUrl(reply!).searchParams.get("utm_content")).toBe("autopilot-workspace");
  });

  it("introduces the project alongside a general thought without claiming it produced that thought", () => {
    const text = "A quiet walk does wonders for perspective.";
    for (let index = 0; index < 60; index += 1) {
      const reply = plugReplyFor(text, `post-${index}`, config())!;
      expect(reply).not.toMatch(/walk|perspective|made (?:this|that)|powered (?:this|that)|using CoLateral/i);
      expect(replyUrl(reply).searchParams.get("utm_content")).toBe("autopilot-general");
    }
  });

  it("is reproducible for the same stored post and varies across accounts, dates and parents", () => {
    const text = "The IDE should fit the way you think.";
    const first = plugReplyFor(text, "2026-10-02:1:primary", config());
    expect(plugReplyFor(text, "2026-10-02:1:primary", config())).toBe(first);

    const copies = new Set<string>();
    for (let day = 1; day <= 30; day += 1) {
      for (const account of ["primary", "secondary"]) {
        copies.add(plugReplyFor(text, `2026-10-${day}:1:${account}`, config())!);
      }
    }
    expect(copies.size).toBeGreaterThanOrEqual(5);
    const parentCopies = new Set(Array.from({ length: 30 }, (_, index) =>
      plugReplyFor(`The IDE experiment number ${index}`, "same-id", config())));
    expect(parentCopies.size).toBeGreaterThanOrEqual(5);
  });

  it("keeps every template concise, conversational and free of unsupported sales promises", () => {
    for (const { text } of CONTEXT_CASES) {
      const copies = new Set(Array.from({ length: 80 }, (_, index) => plugReplyFor(text, `post-${index}`, config())!));
      expect(copies.size).toBeGreaterThanOrEqual(5);
      for (const reply of copies) {
        const line = reply.split("\n")[0];
        expect(line.length).toBeLessThanOrEqual(150);
        expect(reply).not.toMatch(/[—–]|free trial|100%|guarantee|\$|buy now|limited time|millions|comment below|link in bio/i);
        if (line.includes("agent development environment")) expect(line).toMatch(/workspace for agents, files and ideas/);
        expect(reply.length).toBeLessThanOrEqual(THREADS_TEXT_LIMIT);
      }
    }
  });

  it("uses the right attribution for autopilot and pipeline without modifying the destination", () => {
    const destination = "https://colateralai.com/modules?view=engineering#details";
    const settings = config({ plugUrl: destination });
    for (const origin of ["autopilot", "pipeline"] as const) {
      const reply = plugReplyFor("Engineering review", "post-1", settings, origin)!;
      expect(reply.endsWith(threadsReplyUrl(destination, { angle: "engineering", origin })!)).toBe(true);
      const url = replyUrl(reply);
      expect(url.pathname).toBe("/modules");
      expect(url.searchParams.get("view")).toBe("engineering");
      expect(url.hash).toBe("#details");
      expect(url.searchParams.get("utm_content")).toBe(`${origin}-engineering`);
    }
  });

  it("fits the complete attributed destination and skips destinations that cannot safely fit", () => {
    const destination = `https://colateralai.com/${"x".repeat(190)}?view=full#details`;
    const url = threadsReplyUrl(destination, { angle: "workspace", origin: "autopilot" });
    expect(url).toBeDefined();
    const reply = plugReplyFor("The IDE needs care.", "post-1", config({ plugUrl: destination }))!;
    expect(reply.endsWith(url!)).toBe(true);
    expect(reply.length).toBeLessThanOrEqual(THREADS_TEXT_LIMIT);
    expect(plugReplyFor("The IDE needs care.", "post-1", config({ plugUrl: `https://colateralai.com/${"x".repeat(500)}` }))).toBeUndefined();
  });

  it.each(["", " ", "\n\t"])("does not reply to blank parents (%j)", (text) => {
    expect(plugReplyFor(text, "post-1", config())).toBeUndefined();
  });

  it("respects the existing opt-out", () => {
    expect(plugReplyFor("Building CoLateral", "post-1", config({ plugReplies: false }))).toBeUndefined();
    expect(plugReplyFor("Another workflow idea", "post-1", config({ plugReplies: false }))).toBeUndefined();
  });

  it.each(["", " ", "not a URL", "javascript:alert(1)", "mailto:nic@example.com", "https://user:secret@colateralai.com"])(
    "does not emit an unsafe or invalid configured URL (%j)",
    (plugUrl) => {
      expect(plugReplyFor("A useful workflow idea", "post-1", config({ plugUrl }))).toBeUndefined();
    }
  );
});
