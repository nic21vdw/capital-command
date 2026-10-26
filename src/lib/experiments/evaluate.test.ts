import { describe, expect, it } from "vitest";
import type { PostRecord } from "@/lib/analytics/types";
import { evaluateExperiment, newDecisions } from "@/lib/experiments/evaluate";
import { DAY, HOUR, NOW, baselinePosts, experiment, postRecord, queueItem, variant } from "@/lib/experiments/test-helpers";
import type { Experiment } from "@/lib/experiments/types";
import type { QueueItem } from "@/lib/publisher/types";

const at = (daysFromNow: number) => new Date(NOW.getTime() + daysFromNow * DAY).toISOString();
const baseline = () => baselinePosts("youtube", "youtube-primary", [900, 1000, 1100, 1000, 1000, 1200]);

function twoVariants(): Experiment {
  return experiment([
    variant("A", [{ itemId: "a1", publishAt: at(-10) }]),
    variant("B", [{ itemId: "b1", publishAt: at(-7) }])
  ]);
}

function published(): QueueItem[] {
  return [queueItem("a1", at(-10)), queueItem("b1", at(-7))];
}

function measured(aViews: number, bViews: number): PostRecord[] {
  return [
    postRecord({ postId: "ytA", itemId: "a1", publishedAt: at(-10), views: aViews }),
    postRecord({ postId: "ytB", itemId: "b1", publishedAt: at(-7), views: bViews })
  ];
}

describe("evaluateExperiment", () => {
  it("is running, with every variant scheduled, before anything has gone out", () => {
    const report = evaluateExperiment({
      experiment: experiment([variant("A", [{ itemId: "a1", publishAt: at(2) }]), variant("B", [{ itemId: "b1", publishAt: at(4) }])]),
      posts: baseline(),
      queueItems: [queueItem("a1", at(2), { youtube: "scheduled" }), queueItem("b1", at(4), { youtube: "scheduled" })],
      now: NOW
    });
    expect(report.status).toBe("running");
    expect(report.variants.map((entry) => entry.state)).toEqual(["scheduled", "scheduled"]);
    expect(report.winnerId).toBeNull();
  });

  it("is running while a variant's 72 hour window is still open, and says when it closes", () => {
    const young = postRecord({ postId: "ytA", itemId: "a1", views: null, publishedAt: new Date(NOW.getTime() - 20 * HOUR) });
    young.history = [{ date: "2026-10-19", at: new Date(NOW.getTime() - 2 * HOUR).toISOString(), views: 300 }];
    const report = evaluateExperiment({
      experiment: experiment([variant("A", [{ itemId: "a1", publishAt: at(-1) }]), variant("B", [{ itemId: "b1", publishAt: at(2) }])]),
      posts: [...baseline(), young],
      queueItems: [queueItem("a1", at(-1)), queueItem("b1", at(2), { youtube: "scheduled" })],
      now: NOW
    });
    expect(report.status).toBe("running");
    const a = report.variants.find((entry) => entry.id === "A")!;
    expect(a.state).toBe("measuring");
    expect(a.windowEndsAt).toBe(new Date(NOW.getTime() - 20 * HOUR + 72 * HOUR).toISOString());
  });

  it("keeps waiting after the window closes until a sync has read past it", () => {
    const stale = postRecord({ postId: "ytA", itemId: "a1", views: null, publishedAt: new Date(NOW.getTime() - 4 * DAY) });
    stale.history = [{ date: "2026-10-17", at: new Date(NOW.getTime() - 3.5 * DAY).toISOString(), views: 300 }];
    const report = evaluateExperiment({
      experiment: experiment([variant("A", [{ itemId: "a1", publishAt: at(-4) }]), variant("B", [{ itemId: "b1", publishAt: at(-7) }])]),
      posts: [...baseline(), stale, postRecord({ postId: "ytB", itemId: "b1", publishedAt: at(-7), views: 1000 })],
      queueItems: [queueItem("a1", at(-4)), queueItem("b1", at(-7))],
      now: NOW
    });
    expect(report.status).toBe("running");
    expect(report.variants.find((entry) => entry.id === "A")?.state).toBe("waiting");
  });

  it("decides for the variant that beat the account's usual views", () => {
    const report = evaluateExperiment({ experiment: twoVariants(), posts: [...baseline(), ...measured(2400, 1000)], queueItems: published(), now: NOW });
    expect(report.status).toBe("decided");
    expect(report.reason).toBe("winner");
    expect(report.winnerId).toBe("A");
    expect(report.summary).toMatch(/Variant A/);
    const a = report.variants.find((entry) => entry.id === "A")!;
    expect(a.state).toBe("measured");
    expect(a.viewsIndex).toBeCloseTo(2.4, 5);
    expect(a.views).toBe(2400);
  });

  it("does not let the experiment's own posts move the account's usual level", () => {
    const withoutOwn = evaluateExperiment({ experiment: twoVariants(), posts: [...baseline(), ...measured(2400, 1000)], queueItems: published(), now: NOW });
    expect(withoutOwn.variants.find((entry) => entry.id === "B")?.viewsIndex).toBeCloseTo(1, 5);
  });

  it("is inconclusive, naming both variants, when the result is a tie", () => {
    const report = evaluateExperiment({ experiment: twoVariants(), posts: [...baseline(), ...measured(1500, 1480)], queueItems: published(), now: NOW });
    expect(report.status).toBe("inconclusive");
    expect(report.reason).toBe("tie");
    expect(report.winnerId).toBeNull();
    expect(report.summary).toMatch(/A and B/);
  });

  it("is inconclusive with 'not enough data' when a variant is under the minimum", () => {
    const report = evaluateExperiment({ experiment: twoVariants(), posts: [...baseline(), ...measured(2400, 40)], queueItems: published(), now: NOW });
    expect(report.status).toBe("inconclusive");
    expect(report.reason).toBe("not-enough-data");
    expect(report.summary).toMatch(/^Not enough data/);
  });

  it("is inconclusive with 'not enough data' when the account has too few other posts to measure against", () => {
    const report = evaluateExperiment({
      experiment: twoVariants(),
      posts: [...baselinePosts("youtube", "youtube-primary", [900, 1000, 1100]), ...measured(2400, 1000)],
      queueItems: published(),
      now: NOW
    });
    expect(report.reason).toBe("not-enough-data");
  });

  it("is inconclusive straight away when a variant's post was taken off the schedule, without waiting for the others", () => {
    const report = evaluateExperiment({
      experiment: experiment([variant("A", [{ itemId: "a1", publishAt: at(-1) }]), variant("B", [{ itemId: "b1", publishAt: at(3) }])]),
      posts: baseline(),
      queueItems: [queueItem("a1", at(-1), { youtube: "scheduled" })],
      now: NOW
    });
    expect(report.status).toBe("inconclusive");
    expect(report.reason).toBe("removed");
    expect(report.variants.find((entry) => entry.id === "B")?.state).toBe("removed");
    expect(report.summary).toMatch(/B/);
  });

  it("is inconclusive when every platform a variant was booked on failed", () => {
    const report = evaluateExperiment({
      experiment: twoVariants(),
      posts: [...baseline(), postRecord({ postId: "ytA", itemId: "a1", publishedAt: at(-10), views: 2000 })],
      queueItems: [queueItem("a1", at(-10)), queueItem("b1", at(-7), { youtube: "failed" })],
      now: NOW
    });
    expect(report.reason).toBe("removed");
    expect(report.variants.find((entry) => entry.id === "B")?.state).toBe("failed");
  });

  it("is inconclusive as confounded when two variants went out on one platform within 48 hours", () => {
    const report = evaluateExperiment({
      experiment: experiment([variant("A", [{ itemId: "a1", publishAt: at(-10) }]), variant("B", [{ itemId: "b1", publishAt: at(-10) }])]),
      posts: [
        ...baseline(),
        postRecord({ postId: "ytA", itemId: "a1", publishedAt: at(-10), views: 2000 }),
        postRecord({ postId: "ytB", itemId: "b1", publishedAt: new Date(Date.parse(at(-10)) + 20 * HOUR), views: 1000 })
      ],
      queueItems: [queueItem("a1", at(-10)), queueItem("b1", at(-10))],
      now: NOW
    });
    expect(report.status).toBe("inconclusive");
    expect(report.reason).toBe("confounded");
    expect(report.summary).toMatch(/YouTube.*20 hours.*48/);
  });

  it("does not treat two variants on different platforms at the same time as confounded", () => {
    const report = evaluateExperiment({
      experiment: experiment([
        variant("A", [{ itemId: "a1", publishAt: at(-10) }]),
        variant("B", [{ platform: "instagram", itemId: "b1", publishAt: at(-10) }])
      ]),
      posts: [
        ...baseline(),
        ...baselinePosts("instagram", "instagram-primary", [250, 300, 350, 300, 300, 320]),
        postRecord({ postId: "ytA", itemId: "a1", publishedAt: at(-10), views: 1000 }),
        postRecord({ platform: "instagram", postId: "igB", itemId: "b1", publishedAt: at(-10), views: 900 })
      ],
      queueItems: [queueItem("a1", at(-10)), queueItem("b1", at(-10), { instagram: "published" })],
      now: NOW
    });
    expect(report.reason).toBe("winner");
    expect(report.winnerId).toBe("B");
  });

  it("is inconclusive as unmeasured when a week passes after the window with nothing read past it", () => {
    const lost = postRecord({ postId: "ytA", itemId: "a1", views: null, publishedAt: at(-12) });
    lost.history = [{ date: "2026-10-09", at: new Date(Date.parse(at(-12)) + 6 * HOUR).toISOString(), views: 10 }];
    const report = evaluateExperiment({
      experiment: experiment([variant("A", [{ itemId: "a1", publishAt: at(-12) }]), variant("B", [{ itemId: "b1", publishAt: at(-7) }])]),
      posts: [...baseline(), lost, postRecord({ postId: "ytB", itemId: "b1", publishedAt: at(-7), views: 1000 })],
      queueItems: [queueItem("a1", at(-12)), queueItem("b1", at(-7))],
      now: NOW
    });
    expect(report.reason).toBe("unmeasured");
    expect(report.status).toBe("inconclusive");
  });

  it("leaves out a post the platform cannot report on and measures the variant on the rest", () => {
    const report = evaluateExperiment({
      experiment: experiment([
        variant("A", [{ itemId: "a1", publishAt: at(-10) }, { platform: "tiktok", itemId: "a2", publishAt: at(-10) }]),
        variant("B", [{ itemId: "b1", publishAt: at(-7) }, { platform: "tiktok", itemId: "b2", publishAt: at(-7) }])
      ]),
      posts: [
        ...baseline(),
        postRecord({ postId: "ytA", itemId: "a1", publishedAt: at(-10), views: 2400 }),
        postRecord({ platform: "tiktok", postId: "ttA", itemId: "a2", publishedAt: at(-10), views: null, status: "unsupported" }),
        postRecord({ postId: "ytB", itemId: "b1", publishedAt: at(-7), views: 1000 }),
        postRecord({ platform: "tiktok", postId: "ttB", itemId: "b2", publishedAt: at(-7), views: null, status: "unsupported" })
      ],
      queueItems: [
        queueItem("a1", at(-10)),
        queueItem("a2", at(-10), { tiktok: "published" }),
        queueItem("b1", at(-7)),
        queueItem("b2", at(-7), { tiktok: "published" })
      ],
      now: NOW
    });
    expect(report.winnerId).toBe("A");
  });

  it("keeps a decision once it has been made, even if the numbers move afterwards", () => {
    const settled = twoVariants();
    settled.decision = { status: "decided", reason: "winner", winnerId: "B", summary: "Variant B won.", decidedAt: at(-1) };
    const report = evaluateExperiment({ experiment: settled, posts: [...baseline(), ...measured(2400, 1000)], queueItems: published(), now: NOW });
    expect(report.status).toBe("decided");
    expect(report.winnerId).toBe("B");
    expect(report.decidedAt).toBe(at(-1));
  });
});

describe("newDecisions", () => {
  it("returns a decision for each experiment that has just settled and none for ones still running or already settled", () => {
    const settling = twoVariants();
    const running = experiment(
      [variant("A", [{ itemId: "x1", publishAt: at(3) }]), variant("B", [{ itemId: "x2", publishAt: at(5) }])],
      { id: "exp-running" }
    );
    const settled = { ...twoVariants(), id: "exp-done", decision: { status: "decided" as const, reason: "winner" as const, winnerId: "A", summary: "done", decidedAt: at(-2) } };
    const queueItems = [...published(), queueItem("x1", at(3), { youtube: "scheduled" }), queueItem("x2", at(5), { youtube: "scheduled" })];
    const decisions = newDecisions({ experiments: [settling, running, settled], posts: [...baseline(), ...measured(2400, 1000)], queueItems, now: NOW });
    expect([...decisions.keys()]).toEqual(["exp1"]);
    expect(decisions.get("exp1")).toMatchObject({ status: "decided", reason: "winner", winnerId: "A", decidedAt: NOW.toISOString() });
  });
});
