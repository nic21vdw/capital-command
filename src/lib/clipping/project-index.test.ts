import { describe, expect, it } from "vitest";
import { indexProjectsBySource, newestProjectFor } from "@/lib/clipping/project-index";
import type { ClipProject } from "@/types/domain";

function project(id: string, jobId: string, sourceFile: string, updatedAt: string): ClipProject {
  return { id, jobId, sourceFile, updatedAt, name: id } as ClipProject;
}

describe("indexProjectsBySource", () => {
  it("keeps the most recently updated project for a source file", () => {
    const index = indexProjectsBySource([
      project("old", "job1", "clip-1.mp4", "2026-03-01T10:00:00.000Z"),
      project("new", "job1", "clip-1.mp4", "2026-03-04T10:00:00.000Z"),
      project("older", "job1", "clip-1.mp4", "2026-02-01T10:00:00.000Z")
    ]);
    expect(newestProjectFor(index, "job1", "clip-1.mp4")?.id).toBe("new");
  });

  it("keeps the same file name in two runs apart", () => {
    const index = indexProjectsBySource([
      project("a", "job1", "clip-1.mp4", "2026-03-01T10:00:00.000Z"),
      project("b", "job2", "clip-1.mp4", "2026-03-02T10:00:00.000Z")
    ]);
    expect(newestProjectFor(index, "job1", "clip-1.mp4")?.id).toBe("a");
    expect(newestProjectFor(index, "job2", "clip-1.mp4")?.id).toBe("b");
  });

  it("answers nothing for a clip with no project and no source file", () => {
    const index = indexProjectsBySource([project("a", "job1", "clip-1.mp4", "2026-03-01T10:00:00.000Z")]);
    expect(newestProjectFor(index, "job1", "clip-9.mp4")).toBeNull();
    expect(newestProjectFor(index, "job1", undefined)).toBeNull();
  });

  /**
   * The live store is one entry per edit and only grows — 139 projects when
   * this was written. Every clip card used to filter and sort the whole store;
   * the index is built once for all of them.
   */
  it("indexes a real-sized project store once for a whole run of clips", () => {
    const projects = Array.from({ length: 140 }, (_, index) =>
      project(`p${index}`, `job${index % 25}`, `clip-${index % 10}.mp4`, `2026-03-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`)
    );
    const started = performance.now();
    const index = indexProjectsBySource(projects);
    for (let n = 0; n < 250; n += 1) newestProjectFor(index, `job${n % 25}`, `clip-${n % 10}.mp4`);
    expect(performance.now() - started).toBeLessThan(50);
    expect(index.size).toBeLessThanOrEqual(projects.length);
  });
});
