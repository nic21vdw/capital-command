import { describe, expect, it } from "vitest";
import { hookProblem, titleCaseHeading } from "@/lib/carousels/deck";

describe("hookProblem", () => {
  it("passes a hook that states something that happened", () => {
    expect(hookProblem({ heading: "181 subs in 2 days 🚀" })).toBeNull();
    expect(hookProblem({ heading: "I got locked out of my own app 😅" })).toBeNull();
    expect(hookProblem({ heading: "Day 37: the deploy broke at 11pm" })).toBeNull();
  });

  it("rejects the greetings these decks kept opening on", () => {
    expect(hookProblem({ heading: "How are we tonight? Day 37 of vibe coding 🚀" })).toMatch(/greeting/);
    expect(hookProblem({ heading: "Who wants it? 🎉" })).toMatch(/greeting/);
    expect(hookProblem({ heading: "Come on, chat! 🎮" })).toMatch(/greeting/);
    expect(hookProblem({ heading: "Testing the mic — let's go" })).toMatch(/greeting/);
  });

  it("rejects a bare day counter", () => {
    expect(hookProblem({ heading: "Day 34" })).toMatch(/day counter/);
    expect(hookProblem({ heading: "Day 38 of vibe coding 🚀" })).toMatch(/day counter/);
  });

  it("rejects the house catchphrases", () => {
    expect(hookProblem({ heading: "Building in public 🛠️" })).toMatch(/stock phrase/);
    expect(hookProblem({ heading: "This is just the beginning" })).toMatch(/stock phrase/);
  });

  it("rejects a hook with nothing in it", () => {
    expect(hookProblem({ heading: "" })).toMatch(/no heading/);
    expect(hookProblem({ heading: "🚀🔥" })).toMatch(/emoji/);
    expect(hookProblem(undefined)).toMatch(/no heading/);
  });
});

describe("titleCaseHeading", () => {
  it("capitalises the words that carry the meaning", () => {
    expect(titleCaseHeading("Kyle's been here since day 1")).toBe("Kyle's Been Here Since Day 1");
    expect(titleCaseHeading("181 subs in 2 days")).toBe("181 Subs in 2 Days");
  });

  it("leaves the small words alone in the middle and lifts them at the ends", () => {
    expect(titleCaseHeading("locked out of my own app")).toBe("Locked Out of My Own App");
    expect(titleCaseHeading("the deploy broke at 11pm")).toBe("The Deploy Broke at 11pm");
    expect(titleCaseHeading("everything we shipped for")).toBe("Everything We Shipped For");
  });

  it("does not flatten a name that already has its own capitals", () => {
    expect(titleCaseHeading("CoLateral beta is out")).toBe("CoLateral Beta Is Out");
    expect(titleCaseHeading("the OBS scene broke")).toBe("The OBS Scene Broke");
    expect(titleCaseHeading("my PE exam is done")).toBe("My PE Exam Is Done");
  });

  it("capitalises both halves of a compound", () => {
    expect(titleCaseHeading("a copy-paste fix")).toBe("A Copy-Paste Fix");
    expect(titleCaseHeading("the win/loss column")).toBe("The Win/Loss Column");
  });

  it("keeps emoji and spacing exactly where they were", () => {
    expect(titleCaseHeading("shipping august 1st 🗓️")).toBe("Shipping August 1st 🗓️");
    expect(titleCaseHeading("")).toBe("");
  });
});
