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
  const aheadCount = async (from: string, to: string) => {
    if (!(from in graph) || !(to in graph)) throw new Error(`no such ref`);
    return graph[to].filter((commit) => !graph[from].includes(commit)).length;
  };
  return { exists, aheadCount };
}

describe("pickMostAdvanced", () => {
  it("returns null when nothing resolves", async () => {
    const { exists, aheadCount } = fakeGit({});
    expect(await pickMostAdvanced(["github/main", "main"], exists, aheadCount)).toBeNull();
  });

  it("skips remotes this checkout has never fetched", async () => {
    const { exists, aheadCount } = fakeGit({ main: ["a"] });
    expect(await pickMostAdvanced(["github/main", "origin/main", "main"], exists, aheadCount)).toBe(
      "main"
    );
  });

  // The drift this whole module exists for: a pull request merged on GitHub
  // that the local backup remote has not pulled down yet.
  it("takes GitHub when a merged pull request has not reached the backup remote", async () => {
    const { exists, aheadCount } = fakeGit({
      "github/main": ["a", "b", "c"],
      "origin/main": ["a"],
      main: ["a"]
    });
    expect(await pickMostAdvanced(["github/main", "origin/main", "main"], exists, aheadCount)).toBe(
      "github/main"
    );
  });

  // The other direction: the release pushes its changelog commit to the local
  // backup first, so origin can legitimately lead GitHub.
  it("takes the backup remote when the last release only reached it", async () => {
    const { exists, aheadCount } = fakeGit({
      "github/main": ["a", "b"],
      "origin/main": ["a", "b", "changelog"],
      main: ["a", "b", "changelog"]
    });
    expect(await pickMostAdvanced(["github/main", "origin/main", "main"], exists, aheadCount)).toBe(
      "origin/main"
    );
  });

  // Offline: a sandbox worktree merged into main and nothing was uploaded.
  it("takes the local branch when it is ahead of every remote", async () => {
    const { exists, aheadCount } = fakeGit({
      "github/main": ["a"],
      "origin/main": ["a"],
      main: ["a", "b"]
    });
    expect(await pickMostAdvanced(["github/main", "origin/main", "main"], exists, aheadCount)).toBe(
      "main"
    );
  });

  it("keeps the earlier candidate when they are equal, so remotes win ties", async () => {
    const { exists, aheadCount } = fakeGit({
      "github/main": ["a", "b"],
      "origin/main": ["a", "b"],
      main: ["a", "b"]
    });
    expect(await pickMostAdvanced(["github/main", "origin/main", "main"], exists, aheadCount)).toBe(
      "github/main"
    );
  });

  it("keeps the best it has when a comparison cannot be made", async () => {
    const exists = async () => true;
    const aheadCount = async (_from: string, to: string) => {
      if (to === "origin/main") throw new Error("unrelated histories");
      return 0;
    };
    expect(await pickMostAdvanced(["github/main", "origin/main"], exists, aheadCount)).toBe(
      "github/main"
    );
  });
});
