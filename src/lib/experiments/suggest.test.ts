import { describe, expect, it, vi } from "vitest";
import { buildVariantPrompt, parseVariants, suggestVariants } from "@/lib/experiments/suggest";
import { resetBrandKit, saveBrandKitOverrides } from "@/lib/brand/kit";

const runAi = vi.hoisted(() => vi.fn());
const aiConfigured = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/ai", () => ({ runAi, aiConfigured }));

describe("buildVariantPrompt", () => {
  it("asks for different angles on the same clip and carries the current text and the spoken words", () => {
    const prompt = buildVariantPrompt({ kind: "title", base: "Agents Are Eating Software", transcript: "So the thing about agents is they never sleep.", count: 2 });
    expect(prompt.user).toContain("Agents Are Eating Software");
    expect(prompt.user).toContain("they never sleep");
    expect(prompt.user).toMatch(/2 /);
    expect(prompt.user).toMatch(/different angle/i);
    expect(prompt.system).toMatch(/title/i);
  });

  it("writes a hook prompt for an opening line, not a title", () => {
    const prompt = buildVariantPrompt({ kind: "hook", base: "Nobody tells you this.", transcript: "words", count: 2 });
    expect(prompt.system).toMatch(/opening line/i);
    expect(prompt.system).not.toMatch(/Title Case/);
    expect(prompt.system).toContain("CoLateral");
  });
});

describe("parseVariants", () => {
  it("reads a JSON array out of fences and prose", () => {
    const text = 'Here you go:\n```json\n["Why Every App Needs An Agent Now", "I Let An Agent Run My Business"]\n```';
    expect(parseVariants(text, "title", "Agents Are Eating Software", 3)).toEqual(["Why Every App Needs An Agent Now", "I Let An Agent Run My Business"]);
  });

  it("drops anything that repeats the current text or an earlier suggestion", () => {
    const text = JSON.stringify(["agents are eating software!", "A Fresh Take On Agents", "a fresh take on agents"]);
    expect(parseVariants(text, "title", "Agents Are Eating Software", 3)).toEqual(["A Fresh Take On Agents"]);
  });

  it("strips quotes, hashtags and emoji, and drops fragments that are too short to be a title", () => {
    const text = JSON.stringify(['"Why Agents Never Sleep #AI"', "Wow", "Agents Beat Interns \u{1F680} Every Time"]);
    expect(parseVariants(text, "title", "Something Else Entirely", 3)).toEqual(["Why Agents Never Sleep", "Agents Beat Interns Every Time"]);
  });

  it("stops at the number asked for", () => {
    const text = JSON.stringify(["First Good Title Here", "Second Good Title Here", "Third Good Title Here"]);
    expect(parseVariants(text, "title", "Base Title Words", 2)).toHaveLength(2);
  });

  it("accepts a longer line for a hook", () => {
    const hook = "I spent a month letting an agent run my inbox and this is the one thing it got wrong.";
    expect(parseVariants(JSON.stringify([hook]), "hook", "Nobody tells you this.", 2)).toEqual([hook]);
  });

  it("keeps hook suggestions on the saved brand prompt and output rules", async () => {
    await saveBrandKitOverrides({ channels: { youtube: { guide: "Custom operator voice" } }, voice: { substitutions: [{ from: "gadgets", to: "tools" }] } });
    try {
      const prompt = buildVariantPrompt({ kind: "hook", base: "A different opening", transcript: "words", count: 2 });
      expect(prompt.system).toContain("Custom operator voice");
      const hooks = parseVariants(JSON.stringify(["I use gadgets — here is what I learned"]), "hook", "A different opening", 2);
      expect(hooks).toHaveLength(1);
      expect(hooks[0]).toContain("I use tools");
      expect(hooks[0]).not.toMatch(/[—–]/);
    } finally { await resetBrandKit(); }
  });

  it("returns nothing for a reply it cannot read", () => {
    expect(parseVariants("I cannot help with that.", "title", "Base", 2)).toEqual([]);
    expect(parseVariants("[not json", "title", "Base", 2)).toEqual([]);
  });
});

describe("suggestVariants", () => {
  it("is null when no model is available, so the panel can say the variants must be typed", async () => {
    aiConfigured.mockReturnValueOnce(false);
    expect(await suggestVariants({ kind: "title", base: "Base Title Words", transcript: "words", count: 2 })).toBeNull();
    expect(runAi).not.toHaveBeenCalled();
  });

  it("returns the cleaned suggestions from the model", async () => {
    runAi.mockResolvedValueOnce({ text: JSON.stringify(["Why Every App Needs An Agent Now", "I Let An Agent Run My Business"]), refused: false });
    expect(await suggestVariants({ kind: "title", base: "Agents Are Eating Software", transcript: "words", count: 2 })).toEqual([
      "Why Every App Needs An Agent Now",
      "I Let An Agent Run My Business"
    ]);
  });

  it("is null when the model refuses or throws", async () => {
    runAi.mockResolvedValueOnce({ text: "", refused: true });
    expect(await suggestVariants({ kind: "title", base: "Base Title Words", transcript: "words", count: 2 })).toBeNull();
    runAi.mockRejectedValueOnce(new Error("down"));
    expect(await suggestVariants({ kind: "title", base: "Base Title Words", transcript: "words", count: 2 })).toBeNull();
  });
});
