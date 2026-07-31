import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiConfigured, aiMaxTokens, aiProviderInfo, resolveProvider, runAi } from "@/lib/ai/provider";

const AI_ENV = ["AI_PROVIDER", "AI_MAX_TOKENS", "ANTHROPIC_API_KEY", "DEEPSEEK_MODEL", "ANTHROPIC_MODEL"] as const;

describe("ai provider resolution", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(AI_ENV.map((key) => [key, process.env[key]]));
    for (const key of AI_ENV) delete process.env[key];
  });

  afterEach(() => {
    for (const key of AI_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("defaults to DeepSeek Flash (free, keyless)", () => {
    expect(resolveProvider()).toBe("deepseek");
    expect(aiConfigured()).toBe(true);
    expect(aiProviderInfo()).toMatchObject({ provider: "deepseek", free: true });
  });

  it("honours an explicit anthropic selection and requires a key", () => {
    process.env.AI_PROVIDER = "anthropic";
    expect(resolveProvider()).toBe("anthropic");
    expect(aiConfigured()).toBe(false);
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(aiConfigured()).toBe(true);
    expect(aiProviderInfo()).toMatchObject({ provider: "anthropic", free: false });
  });

  it("auto mode prefers Claude only when a key is present", () => {
    process.env.AI_PROVIDER = "auto";
    expect(resolveProvider()).toBe("deepseek");
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(resolveProvider()).toBe("anthropic");
  });

  it("gives every call at least the free budget and honours larger requests", () => {
    expect(aiMaxTokens()).toBe(8000);
    expect(aiMaxTokens(300)).toBe(8000); // tiny request lifted to the free budget
    expect(aiMaxTokens(16000)).toBe(16000); // larger request preserved
    expect(aiMaxTokens(999999)).toBe(32000); // capped at the hard ceiling
  });

  it("lets AI_MAX_TOKENS raise the free budget", () => {
    process.env.AI_MAX_TOKENS = "12000";
    expect(aiMaxTokens()).toBe(12000);
    expect(aiMaxTokens(300)).toBe(12000);
  });
});

/**
 * DeepSeek Flash is a reasoning model: it thinks in `reasoning_content` and
 * answers in `content`, out of one shared token budget. Reading only `content`
 * and calling an empty one a dead provider is what made every AI feature fall
 * back to its offline heuristic on any sizeable request.
 */
describe("deepseek reasoning budget", () => {
  let saved: Record<string, string | undefined>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    saved = Object.fromEntries(AI_ENV.map((key) => [key, process.env[key]]));
    for (const key of AI_ENV) delete process.env[key];
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of AI_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  type Reply = { content?: string; reasoning?: string; finish?: string };

  /** One OpenAI-shaped reply body. */
  function reply(body: Reply): Reply {
    return body;
  }

  /**
   * Serves the given replies in order, repeating the last one. A fresh Response
   * per call — a body can only be read once, and the escalation makes several.
   */
  function stubReplies(...replies: Reply[]) {
    const calls: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = replies[Math.min(calls.length, replies.length - 1)];
      calls.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: body.finish ?? "stop",
              message: { content: body.content ?? "", reasoning_content: body.reasoning ?? "" }
            }
          ]
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
  }

  it("returns the answer when the model has room to finish", async () => {
    stubReplies(reply({ content: "the answer", reasoning: "thinking out loud" }));

    await expect(runAi({ messages: [{ role: "user", content: "hi" }] })).resolves.toEqual({
      text: "the answer",
      refused: false
    });
  });

  it("retries with a bigger budget when the whole budget went on thinking", async () => {
    const calls = stubReplies(
      reply({ content: "", reasoning: "still working on it", finish: "length" }),
      reply({ content: "the answer" })
    );

    const result = await runAi({ messages: [{ role: "user", content: "hi" }] });

    expect(result).toEqual({ text: "the answer", refused: false });
    expect(calls.map((call) => call.max_tokens)).toEqual([8000, 16000]);
  });

  it("keeps doubling up to the hard ceiling, then gives up", async () => {
    const calls = stubReplies(reply({ content: "", reasoning: "thinking", finish: "length" }));

    await expect(runAi({ messages: [{ role: "user", content: "hi" }] })).resolves.toBeNull();
    expect(calls.map((call) => call.max_tokens)).toEqual([8000, 16000, 32000]);
  });

  it("never passes the model's scratchpad off as the answer", async () => {
    stubReplies(reply({ content: "", reasoning: "a very long private train of thought", finish: "length" }));

    const result = await runAi({ messages: [{ role: "user", content: "hi" }] });

    // Giving up (null) is the right answer here; handing back the scratchpad
    // as if it were the reply would not be.
    expect(result?.text ?? "").not.toContain("private train of thought");
  });

  it("does not retry an empty answer that wasn't a budget problem", async () => {
    const calls = stubReplies(reply({ content: "", finish: "stop" }));

    await expect(runAi({ messages: [{ role: "user", content: "hi" }] })).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("reports a refusal instead of burning the budget on retries", async () => {
    const calls = stubReplies(reply({ content: "", reasoning: "hmm", finish: "content_filter" }));

    await expect(runAi({ messages: [{ role: "user", content: "hi" }] })).resolves.toEqual({
      text: "",
      refused: true
    });
    expect(calls).toHaveLength(1);
  });

  it("starts from the caller's own budget, not the floor", async () => {
    const calls = stubReplies(
      reply({ content: "", reasoning: "thinking", finish: "length" }),
      reply({ content: "the answer" })
    );

    await runAi({ maxTokens: 16000, messages: [{ role: "user", content: "hi" }] });

    expect(calls.map((call) => call.max_tokens)).toEqual([16000, 32000]);
  });
});
