import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiConfigured, aiMaxTokens, aiProviderInfo, resolveProvider } from "@/lib/ai/provider";

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
