import { describe, expect, it } from "vitest";
import { brandViolations } from "@/lib/brand/kit";
import { plugReplyFor } from "@/lib/threads/plug";
import { threadsConfig } from "@/lib/threads/config";
import { COLATERAL_LIBRARY, POST_LIBRARY, REPLY_LIBRARY } from "@/lib/x-posts/library";

const flatten = (entry: unknown): string[] => {
  if (typeof entry === "string") return [entry];
  if (entry && typeof entry === "object") return Object.values(entry).flatMap(flatten);
  return [];
};

const violationsOf = (texts: string[], channel: "threads") =>
  texts.flatMap((text) =>
    brandViolations(text, channel)
      .filter((violation) => violation.kind !== "dash")
      .map((violation) => `${violation.kind} "${violation.match}" in: ${text.slice(0, 80)}`)
  );

describe("the built-in copy libraries obey the kit", () => {
  it("has no banned word, claim, hashtag, emoji or retired name in the post library", () => {
    const texts = [...COLATERAL_LIBRARY, ...POST_LIBRARY, ...REPLY_LIBRARY].flatMap(flatten);
    expect(texts.length).toBeGreaterThan(50);
    expect(violationsOf(texts, "threads")).toEqual([]);
  });

  it("has no banned word, claim, hashtag, emoji or retired name in any link-reply invitation", () => {
    const config = { ...threadsConfig(), plugReplies: true, plugUrl: "https://colateralai.com" };
    const probes = [
      "engineer beam slab",
      "arcade game",
      "marketing content creators",
      "workspace canvas",
      "custom tool automation",
      "agents claude codex",
      "build ship launch",
      "a quiet thought"
    ];
    const lines = new Set<string>();
    for (const probe of probes) {
      for (let seed = 0; seed < 40; seed += 1) {
        const reply = plugReplyFor(probe, `seed-${seed}`, config);
        if (reply) lines.add(reply.split("\n")[0]);
      }
    }
    expect(lines.size).toBeGreaterThan(20);
    expect(violationsOf([...lines], "threads")).toEqual([]);
  });
});
