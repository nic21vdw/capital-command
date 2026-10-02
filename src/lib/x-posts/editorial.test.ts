import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiConfigured, runAi } from "@/lib/ai";
import { generateDailyPack, libraryPack, POSTS_PER_PACK, REPLIES_PER_PACK } from "@/lib/x-posts/generator";

vi.mock("@/lib/ai", () => ({ aiConfigured: vi.fn(), runAi: vi.fn() }));

const input = {
  brief:
    "Developers, creators and engineers work on a desktop project canvas. A game module is an experiment, not a released feature.",
  date: "2026-10-02",
  focus: "Small custom tools people can build for their own jobs",
  recentTopics: ["AI output versus review time"]
};

function modelPack() {
  const fallback = libraryPack(input.date, input.focus);
  return {
    posts: fallback.posts.map(({ format, topic, text, threadsVariant }) => ({
      format,
      topic,
      text,
      threadsVariant
    })),
    replies: fallback.replies.map(({ scenario, text }) => ({ scenario, text }))
  };
}

function respond(pack: ReturnType<typeof modelPack>) {
  vi.mocked(runAi).mockResolvedValue({
    text: JSON.stringify(pack),
    refused: false
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(aiConfigured).mockReturnValue(true);
  vi.stubEnv("THREADS_TYPO_RATE", "0");
});

afterEach(() => vi.unstubAllEnvs());

describe("Threads editorial contract", () => {
  it("asks for substantive discovery angles and separates verified features from ideas", async () => {
    respond(modelPack());
    await generateDailyPack(input);
    const request = vi.mocked(runAi).mock.calls[0][0];
    const prompt = request.messages[0].content;

    expect(prompt).toContain(input.brief);
    expect(prompt).toContain(input.focus);
    expect(prompt).toContain(input.recentTopics[0]);
    expect(prompt).toContain("Each parent must be useful on its own");
    expect(prompt).toContain("a small tool idea for a familiar annoying job");
    expect(prompt).toContain("developers seeing how agents and project files fit together");
    expect(prompt).toContain("creators keeping ideas beside the work");
    expect(prompt).toContain("engineers inspecting inputs and assumptions");
    expect(prompt).toContain("Games, modules, CoLateral Engineering and CoLateral Marketing");
    expect(prompt).toContain("The brief and optional focus provide topics, not automatic proof");
    expect(prompt).toContain('never convert them to "you can now"');
    expect(prompt).toContain("Never invent personal anecdotes");
    expect(prompt).toContain("Never name a client");
    expect(prompt).toContain("Do not put any URL, domain");
    expect(prompt).toContain("separate from the automatic self-replies");
    expect(prompt).toContain("Exactly 8 of the 24");
  });

  it("accepts a complete grounded pack and preserves its schedule and two distinct versions", async () => {
    const raw = modelPack();
    respond(raw);
    const result = await generateDailyPack(input);
    expect(result.reason).toBeNull();
    expect(result.pack.source).toBe("ai");
    expect(result.pack.posts).toHaveLength(POSTS_PER_PACK);
    expect(result.pack.replies).toHaveLength(REPLIES_PER_PACK);
    expect(result.pack.posts.map((post) => post.text)).toEqual(raw.posts.map((post) => post.text));
    expect(result.pack.posts.map((post) => post.time)).toEqual(
      libraryPack(input.date, input.focus).posts.map((post) => post.time)
    );
  });

  it.each(["https://example.com/demo", "colateralai.com", "www.example.org"])(
    "falls back instead of letting a parent URL through: %s",
    async (link) => {
      const raw = modelPack();
      raw.posts[0].text = `A useful project starts with a small job you can check. See the desktop workspace at ${link}`;
      respond(raw);
      const result = await generateDailyPack(input);
      expect(result.pack.source).toBe("library");
      expect(result.reason).toContain("a parent post included a link");
      expect(result.pack.posts.flatMap((post) => [post.text, post.threadsVariant]).join("\n")).not.toContain(link);
    }
  );

  it.each([
    [
      "short",
      (raw: ReturnType<typeof modelPack>) => {
        raw.posts[0].text = "Build small.";
      },
      "short post"
    ],
    [
      "warm",
      (raw: ReturnType<typeof modelPack>) => {
        raw.posts[0].threadsVariant = "A short repeat.";
      },
      "warm post"
    ],
    [
      "hashtags",
      (raw: ReturnType<typeof modelPack>) => {
        raw.posts[0].text += " #AI";
      },
      "hashtags or emoji"
    ],
    [
      "emoji",
      (raw: ReturnType<typeof modelPack>) => {
        raw.posts[0].text += " 🚀";
      },
      "hashtags or emoji"
    ],
    [
      "retired name",
      (raw: ReturnType<typeof modelPack>) => {
        raw.posts[0].text = raw.posts[0].text.replace("tiny tool", "Capital Command");
      },
      "retired product name"
    ],
    [
      "mismatched brand versions",
      (raw: ReturnType<typeof modelPack>) => {
        raw.posts[2].threadsVariant = raw.posts[2].threadsVariant.replaceAll("CoLateral", "the app");
      },
      "two versions disagreed"
    ],
    [
      "brand count",
      (raw: ReturnType<typeof modelPack>) => {
        raw.posts[2].text = raw.posts[2].text.replaceAll("CoLateral", "the app");
        raw.posts[2].threadsVariant = raw.posts[2].threadsVariant.replaceAll("CoLateral", "the app");
      },
      "CoLateral post mix"
    ],
    [
      "adjacent brand posts",
      (raw: ReturnType<typeof modelPack>) => {
        [raw.posts[0], raw.posts[5]] = [raw.posts[5], raw.posts[0]];
        [raw.posts[1], raw.posts[8]] = [raw.posts[8], raw.posts[1]];
      },
      "posts were adjacent"
    ],
    [
      "repeated opening",
      (raw: ReturnType<typeof modelPack>) => {
        raw.posts[0].threadsVariant = `${raw.posts[0].text} Give it a small task and check the output carefully before trying anything larger with your important files.`;
      },
      "repeated its short opening"
    ],
    [
      "repeated angle",
      (raw: ReturnType<typeof modelPack>) => {
        raw.posts[1].topic = raw.posts[0].topic;
      },
      "repeated an angle"
    ],
    [
      "single format",
      (raw: ReturnType<typeof modelPack>) => {
        raw.posts.forEach((post) => {
          post.format = "insight";
        });
      },
      "vary its post formats"
    ],
    [
      "evergreen reply link",
      (raw: ReturnType<typeof modelPack>) => {
        raw.replies[0].text += " https://colateralai.com";
      },
      "evergreen reply included"
    ]
  ])("rejects %s and returns a complete safe pack", async (_name, alter, reason) => {
    const raw = modelPack();
    alter(raw);
    respond(raw);
    const result = await generateDailyPack(input);
    expect(result.pack.source).toBe("library");
    expect(result.reason).toContain(reason);
    expect(result.pack.posts).toHaveLength(POSTS_PER_PACK);
    expect(result.pack.replies).toHaveLength(REPLIES_PER_PACK);
  });

  it("fills an incomplete model output without losing the brand ratio", async () => {
    const raw = modelPack();
    raw.posts.pop();
    raw.replies.pop();
    respond(raw);
    const result = await generateDailyPack(input);
    expect(result.reason).toBeNull();
    expect(result.pack.posts).toHaveLength(POSTS_PER_PACK);
    expect(result.pack.posts.filter((post) => post.text.includes("CoLateral"))).toHaveLength(8);
    expect(result.pack.replies).toHaveLength(REPLIES_PER_PACK);
  });

  it("uses the offline library without attempting AI when no provider is configured", async () => {
    vi.mocked(aiConfigured).mockReturnValue(false);
    const result = await generateDailyPack(input);
    expect(result.pack.source).toBe("library");
    expect(runAi).not.toHaveBeenCalled();
  });
});
