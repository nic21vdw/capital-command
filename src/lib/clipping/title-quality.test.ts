import { describe, expect, it } from "vitest";
import {
  firstPublishableTitle,
  judgeTitle,
  titleIsPublishable,
  TITLE_QUALITY_RULES
} from "./title-quality";

// Every title in this block actually shipped to the channel as a Short, or is
// sitting in the publish queue waiting to. They are the reason the gate exists,
// so each one is pinned to the rule that must catch it.
const SHIPPED_SLUDGE: Array<[string, string]> = [
  ["Brag of It 80 Get the Best 80", "stray-numeral"],
  ["Thank, Max and Tool", "leading-comma"],
  ["Have We've Started on This Grind", "auxiliary-opening"],
  ["What Is Up My Man", "self-talk"],
  ["I'm Curious How This Has to Do with Bonds", "self-talk"],
  ["Inside Your Local", "too-short"],
  ["Have 16 Members", "too-short"],
  ["July's Been a Great Month", "no-topic"],
  ["Let's Get Started", "too-short"],
  ["the about page, the tools page, the about page", "repeated-phrase"],
  ["Show Beginners How to Vibe Code With ChatGPT", "todo-voice"]
];

// Real winners from the channel. A gate that rejects any of these is too
// aggressive and is worse than no gate at all.
const REAL_WINNERS = [
  "FABLE 5 IS GONE 😭😭",
  "Claude is my personal favourite AI",
  "CoLateral: The All In One Infinite Workspace for Engineers",
  "Replace AutoCAD and Revit With One AI Workspace",
  "Why I Use Opus 5 Despite the Cost"
];

describe("judgeTitle rejects the titles that shipped as sludge", () => {
  for (const [title, code] of SHIPPED_SLUDGE) {
    it(`rejects ${JSON.stringify(title)} as ${code}`, () => {
      const judgement = judgeTitle(title);
      expect(judgement.publishable).toBe(false);
      expect(judgement.code).toBe(code);
      expect(judgement.reason).toBeTruthy();
      expect(judgement.score).toBe(0);
    });
  }
});

describe("judgeTitle accepts the channel's real winners", () => {
  for (const title of REAL_WINNERS) {
    it(`accepts ${JSON.stringify(title)}`, () => {
      const judgement = judgeTitle(title);
      expect(judgement.publishable).toBe(true);
      expect(judgement.code).toBeUndefined();
      expect(judgement.score).toBeGreaterThan(0);
    });
  }

  it("scores a title that names a tool up front above one that names nothing", () => {
    const named = judgeTitle("Why I Use Opus 5 Despite the Cost");
    const vague = judgeTitle("Why I Use That Thing Despite the Cost");
    expect(named.score).toBeGreaterThan(vague.score);
    expect(vague.warnings).toContain("no-named-subject");
  });

  it("warns rather than rejects when the creator says we", () => {
    const judgement = judgeTitle("We Got Copyright Claimed for Wonderwall");
    expect(judgement.publishable).toBe(true);
    expect(judgement.warnings).toContain("we-voice");
  });
});

describe("judgeTitle structural rules", () => {
  it("rejects an empty or whitespace-only title", () => {
    expect(judgeTitle("").code).toBe("empty");
    expect(judgeTitle("   ").code).toBe("empty");
    expect(judgeTitle("🚀🚀").code).toBe("empty");
  });

  it("rejects a title longer than a Short can show", () => {
    expect(judgeTitle(`Claude ${"builds ".repeat(20)}apps`).code).toBe("too-long");
  });

  it("rejects a dangling preposition or conjunction at either end", () => {
    expect(judgeTitle("With Claude Writing Every Line").code).toBe("dangling-edge");
    expect(judgeTitle("Claude Writes the Code I Used To").code).toBe("dangling-edge");
  });

  it("rejects a doubled auxiliary anywhere in the phrase", () => {
    expect(judgeTitle("Claude Has Is Writing My Whole App").code).toBe("doubled-auxiliary");
    expect(judgeTitle("Claude Did We've Ship the Whole App").code).toBe("doubled-auxiliary");
  });

  it("rejects an immediately repeated phrase", () => {
    expect(judgeTitle("Vibe Coding My Vibe Coding Workflow").code).toBe("repeated-phrase");
  });

  it("keeps numbers that belong to a name or a noun", () => {
    expect(titleIsPublishable("How I Plan 75 Push-Ups For Subscribers")).toBe(true);
    expect(titleIsPublishable("Claude Opus 5 Just Dropped and It's Unreal")).toBe(true);
  });

  it("does not mistake a viewer-facing imperative for a creator to-do", () => {
    expect(titleIsPublishable("Stop Doing Work, Just Talk to AI")).toBe(true);
    expect(titleIsPublishable("Replace AutoCAD and Revit With One AI Workspace")).toBe(true);
  });
});

describe("firstPublishableTitle", () => {
  it("returns the first candidate that clears the gate", () => {
    expect(firstPublishableTitle(["Let's Get Started", undefined, "Claude is my personal favourite AI"])).toBe(
      "Claude is my personal favourite AI"
    );
  });

  it("returns null when nothing clears it, so callers can ask for a human title", () => {
    expect(firstPublishableTitle(["Let's Get Started", "Inside Your Local", ""])).toBeNull();
  });
});

describe("TITLE_QUALITY_RULES", () => {
  it("spells out the audit rules for the AI titler's prompt", () => {
    const text = TITLE_QUALITY_RULES.join("\n").toLowerCase();
    expect(text).toContain("first four words");
    expect(text).toContain("present-tense");
    expect(text).toContain("we");
  });
});
