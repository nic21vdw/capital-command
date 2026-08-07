import { describe, expect, it } from "vitest";
import { episodeCandidates } from "@/lib/podcast/candidates";
import type { LongformExportRecord, LongformProject } from "@/lib/longform/types";
import type { PodcastEpisode } from "@/lib/podcast/types";

function record(overrides: Partial<LongformExportRecord> = {}): LongformExportRecord {
  return {
    id: "exp-1",
    status: "done",
    progress: 1,
    file: "edit.mp4",
    durationSec: 2400,
    createdAt: "2026-08-01T12:00:00.000Z",
    ...overrides
  };
}

function project(overrides: Partial<LongformProject> = {}): LongformProject {
  return {
    id: "proj-1",
    name: "Stream 2026-08-01",
    exports: [record()],
    ...overrides
  } as LongformProject;
}

function episode(overrides: Partial<PodcastEpisode> = {}): PodcastEpisode {
  return {
    id: "ep-1",
    title: "Episode",
    description: "",
    audioUrl: "https://cdn.example.com/ep-1.mp3",
    audioKey: "podcast/episodes/ep-1.mp3",
    bytes: 1,
    durationSec: 1,
    publishedAt: "2026-08-01T12:00:00.000Z",
    ...overrides
  };
}

describe("episodeCandidates", () => {
  it("offers finished exports newest first", () => {
    const projects = [
      project({ id: "old", exports: [record({ id: "a", createdAt: "2026-07-01T12:00:00.000Z" })] }),
      project({ id: "new", exports: [record({ id: "b", createdAt: "2026-08-05T12:00:00.000Z" })] })
    ];
    expect(episodeCandidates(projects, []).map((candidate) => candidate.exportId)).toEqual(["b", "a"]);
  });

  it("skips exports that have not finished rendering", () => {
    const projects = [project({ exports: [record({ id: "a", status: "processing", file: undefined })] })];
    expect(episodeCandidates(projects, [])).toEqual([]);
  });

  it("marks what is already an episode rather than hiding it", () => {
    const candidates = episodeCandidates([project()], [episode({ exportId: "exp-1" })]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].published).toBe(true);
  });

  it("reports whether the MP3 has been cut, and titles the export", () => {
    const projects = [project({ exports: [record({ title: "How I built it", audioFile: "edit.mp3" })] })];
    expect(episodeCandidates(projects, [])[0]).toMatchObject({ title: "How I built it", hasAudio: true });
    expect(episodeCandidates([project()], [])[0]).toMatchObject({ title: "Stream 2026-08-01", hasAudio: false });
  });
});
