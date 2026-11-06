import { describe, expect, it } from "vitest";
import type { ExperimentReport, VariantReport } from "@/lib/experiments/evaluate";
import { experimentGroups, experimentTitle, reasonLabel, statusCounts, variantLine, variantStateLabel } from "@/lib/experiments/view";

function variant(overrides: Partial<VariantReport>): VariantReport {
  return {
    id: "A",
    value: "Agents Are Eating Software",
    origin: "original",
    state: "measured",
    publishAt: "2026-10-10T15:00:00.000Z",
    publishedAt: "2026-10-10T15:00:00.000Z",
    windowEndsAt: "2026-10-13T15:00:00.000Z",
    posts: 1,
    measuredPosts: 1,
    views: 2400,
    viewsIndex: 2.4,
    rateIndex: null,
    score: 2.4,
    ...overrides
  };
}

function report(overrides: Partial<ExperimentReport> = {}): ExperimentReport {
  return {
    id: "e1",
    kind: "title",
    source: { label: "Clip about agents" },
    createdAt: "2026-10-09T15:00:00.000Z",
    windowHours: 72,
    status: "decided",
    reason: "winner",
    winnerId: "A",
    summary: "Variant A won.",
    decidedAt: "2026-10-20T15:00:00.000Z",
    variants: [variant({}), variant({ id: "B", value: "Why Every App Needs An Agent Now", views: 1000, viewsIndex: 1, score: 1, origin: "ai" })],
    ...overrides
  };
}

describe("experiment view helpers", () => {
  it("groups experiments into running, decided and inconclusive, keeping the order given", () => {
    const groups = experimentGroups([
      report({ id: "1", status: "running", reason: null, winnerId: null }),
      report({ id: "2" }),
      report({ id: "3", status: "inconclusive", reason: "tie", winnerId: null }),
      report({ id: "4", status: "running", reason: null, winnerId: null })
    ]);
    expect(groups.running.map((entry) => entry.id)).toEqual(["1", "4"]);
    expect(groups.decided.map((entry) => entry.id)).toEqual(["2"]);
    expect(groups.inconclusive.map((entry) => entry.id)).toEqual(["3"]);
  });

  it("counts them in one line", () => {
    expect(statusCounts([])).toBe("No experiments yet");
    expect(
      statusCounts([report({ status: "running", reason: null }), report({ status: "running", reason: null }), report(), report({ status: "inconclusive", reason: "tie" })])
    ).toBe("2 running, 1 decided, 1 inconclusive");
  });

  it("titles an experiment by what is tested and on what", () => {
    expect(experimentTitle(report())).toBe("Title test: Clip about agents");
    expect(experimentTitle(report({ kind: "hook", source: { label: "Podcast clip" } }))).toBe("Hook test: Podcast clip");
  });

  it("names each variant state in words", () => {
    expect(variantStateLabel("scheduled")).toBe("Scheduled");
    expect(variantStateLabel("measuring")).toBe("Measuring");
    expect(variantStateLabel("waiting")).toBe("Waiting for the next sync");
    expect(variantStateLabel("measured")).toBe("Measured");
    expect(variantStateLabel("removed")).toBe("Taken off the schedule");
    expect(variantStateLabel("failed")).toBe("Did not go out");
    expect(variantStateLabel("unmeasured")).toBe("Could not be measured");
  });

  it("names every reason an experiment can end", () => {
    expect(reasonLabel("winner")).toBe("Winner");
    expect(reasonLabel("tie")).toBe("Too close to call");
    expect(reasonLabel("not-enough-data")).toBe("Not enough data");
    expect(reasonLabel("removed")).toBe("A variant never went out");
    expect(reasonLabel("confounded")).toBe("Variants too close in time");
    expect(reasonLabel("unmeasured")).toBe("Could not be measured");
    expect(reasonLabel(null)).toBe("Running");
  });

  it("describes a measured variant with its text, views and how it compared with a normal post", () => {
    expect(variantLine(variant({}))).toBe('A "Agents Are Eating Software": 2,400 views, 2.4x a typical post');
  });

  it("describes a variant that is still waiting without inventing numbers", () => {
    expect(variantLine(variant({ state: "scheduled", views: null, viewsIndex: null, score: null }))).toBe('A "Agents Are Eating Software": Scheduled');
    expect(variantLine(variant({ state: "measuring", views: null, viewsIndex: null, score: null, windowEndsAt: "2026-10-13T15:00:00.000Z" }), "America/Toronto")).toMatch(
      /Measuring until Oct 13/
    );
  });
});
