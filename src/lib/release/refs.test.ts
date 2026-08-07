import { describe, expect, it } from "vitest";
import { pickMostAdvanced, releaseRefCandidates } from "@/lib/release/refs";

describe("releaseRefCandidates", () => {
  it("puts every remote's branch first and the local branch last", () => {
    expect(releaseRefCandidates(["github", "origin"], "main")).toEqual([
      "github/main",
      "origin/main",
      "main"
    ]);
  });

  it("survives a checkout with no remotes at all", () => {
    expect(releaseRefCandidates([], "main")).toEqual(["main"]);
  });

  it("does not list the same remote twice", () => {
    expect(releaseRefCandidates(["github", "github"], "main")).toEqual(["github/main", "main"]);
  });
});

/** `graph[ref]` is everything that ref contains, itself included. */
function fakeGit(graph: Record<string, string[]>) {
  const exists = async (ref: string) => ref in graph;
  const compare = async (from: string, to: string) => {
    if (!(from in graph) || !(to in graph)) throw new Error("no such ref");
    return {
      ahead: graph[to].filter((commit) => !graph[from].includes(commit)).length,
      behind: graph[from].filter((commit) => !graph[to].includes(commit)).length
    };
  };
  return { exists, compare };
}

describe("pickMostAdvanced", () => {
  it("returns null when nothing resolves", async () => {
    const { exists, compare } = fakeGit({});
    expect(await pickMostAdvanced(["github/main", "main"], exists, compare)).toBeNull();
  });

  it("skips remotes this checkout has never fetched", async () => {
    const { exists, compare } = fakeGit({ main: ["a"] });
    expect(await pickMostAdvanced(["github/main", "origin/main", "main"], exists, compare)).toBe(
      "main"
    );
  });

  it("takes GitHub when a merged pull request has not reached the backup remote", async () => {
    const { exists, compare } = fakeGit({
      "github/main": ["a", "b", "c"],
      "origin/main": ["a"],
      main: ["a"]
    });
    expect(await pickMostAdvanced(["github/main", "origin/main", "main"], exists, compare)).toBe(
      "github/main"
    );
  });

  it("takes the backup remote when the last release only reached it", async () => {
    const { exists, compare } = fakeGit({
      "github/main": ["a", "b"],
      "origin/main": ["a", "b", "changelog"],
      main: ["a", "b", "changelog"]
    });
    expect(await pickMostAdvanced(["github/main", "origin/main", "main"], exists, compare)).toBe(
      "origin/main"
    );
  });

  it("takes the local branch when it is ahead of every remote", async () => {
    const { exists, compare } = fakeGit({
      "github/main": ["a"],
      "origin/main": ["a"],
      main: ["a", "b"]
    });
    expect(await pickMostAdvanced(["github/main", "origin/main", "main"], exists, compare)).toBe(
      "main"
    );
  });

  it("keeps the earlier candidate when they are equal, so remotes win ties", async () => {
    const { exists, compare } = fakeGit({
      "github/main": ["a", "b"],
      "origin/main": ["a", "b"],
      main: ["a", "b"]
    });
    expect(await pickMostAdvanced(["github/main", "origin/main", "main"], exists, compare)).toBe(
      "github/main"
    );
  });

  // The real state of this repository, and what an "ahead > 0" rule got wrong:
  // GitHub had five merged pull requests, the backup had the release's own
  // changelog commit, and each was ahead of the other. Picking the backup
  // because it was compared last reported "up to date" with five PRs waiting.
  it("takes the side carrying more when the two remotes have diverged", async () => {
    const { exists, compare } = fakeGit({
      "github/main": ["a", "pr1", "pr2", "pr3", "pr4", "pr5"],
      "origin/main": ["a", "changelog"],
      main: ["a", "changelog"]
    });
    expect(await pickMostAdvanced(["github/main", "origin/main", "main"], exists, compare)).toBe(
      "github/main"
    );
  });

  it("still takes the backup when the fork leans the other way", async () => {
    const { exists, compare } = fakeGit({
      "github/main": ["a", "pr1"],
      "origin/main": ["a", "x", "y", "z"],
      main: ["a", "x", "y", "z"]
    });
    expect(await pickMostAdvanced(["github/main", "origin/main", "main"], exists, compare)).toBe(
      "origin/main"
    );
  });

  it("keeps the best it has when a comparison cannot be made", async () => {
    const exists = async () => true;
    const compare = async (_from: string, to: string) => {
      if (to === "origin/main") throw new Error("unrelated histories");
      return { ahead: 0, behind: 0 };
    };
    expect(await pickMostAdvanced(["github/main", "origin/main"], exists, compare)).toBe(
      "github/main"
    );
  });
});
