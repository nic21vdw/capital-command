import { describe, expect, it } from "vitest";
import { cleanTypedTitle, titleHint, titleSignals } from "@/lib/clipping/titleSignals";

describe("titleSignals", () => {
  it("spots a number and a named model or tool", () => {
    expect(titleSignals("I Owe 500 Push-Ups to My Subscribers")).toEqual({ number: true, tool: false });
    expect(titleSignals("Does Fable 5.2 on Low Beat Opus 5.5 on High?")).toEqual({ number: true, tool: true });
    expect(titleSignals("I Gave Claude Full Control of My App")).toEqual({ number: false, tool: true });
    expect(titleSignals("Building the Agentic Workspace of the Future")).toEqual({ number: false, tool: false });
  });

  it("does not read a tool name inside another word", () => {
    expect(titleSignals("Obscure bugs and opusculent prose").tool).toBe(false);
  });
});

describe("titleHint", () => {
  it("nudges only a title with neither a number nor a named tool", () => {
    expect(titleHint("Building the Agentic Workspace of the Future")).toMatch(/No number or named tool/);
    expect(titleHint("How I Hit 3,700 Posts on X")).toBeNull();
    expect(titleHint("Why Codex Lost This One")).toBeNull();
  });
});

describe("cleanTypedTitle", () => {
  it("trims and collapses spaces, and refuses an empty or over-long title", () => {
    expect(cleanTypedTitle("  Claude rebuilt   my map  ")).toBe("Claude rebuilt my map");
    expect(cleanTypedTitle("   ")).toBeNull();
    expect(cleanTypedTitle("x".repeat(101))).toBeNull();
    expect(cleanTypedTitle(42)).toBeNull();
  });
});
