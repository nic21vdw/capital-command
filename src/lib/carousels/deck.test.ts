import { describe, expect, it } from "vitest";
import { hookProblem } from "@/lib/carousels/deck";

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
