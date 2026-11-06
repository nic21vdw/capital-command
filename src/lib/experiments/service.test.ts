import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { updateMetrics } from "@/lib/analytics/store";
import { experimentReports } from "@/lib/experiments/service";
import { experimentsFile, readExperiments, updateExperiments } from "@/lib/experiments/store";
import { DAY, NOW, baselinePosts, experiment, postRecord, queueItem, variant } from "@/lib/experiments/test-helpers";
import { publishQueue } from "@/lib/publisher/queue";

const at = (daysFromNow: number) => new Date(NOW.getTime() + daysFromNow * DAY).toISOString();

async function seedFinished(id: string) {
  await updateExperiments((file) => {
    file.experiments.push(
      experiment([variant("A", [{ itemId: `${id}-a`, publishAt: at(-10) }]), variant("B", [{ itemId: `${id}-b`, publishAt: at(-7) }])], { id })
    );
  });
  await updateMetrics((store) => {
    for (const post of [
      ...baselinePosts("youtube", "youtube-primary", [900, 1000, 1100, 1000, 1000, 1200]),
      postRecord({ postId: `${id}-ytA`, itemId: `${id}-a`, publishedAt: at(-10), views: 2400 }),
      postRecord({ postId: `${id}-ytB`, itemId: `${id}-b`, publishedAt: at(-7), views: 1000 })
    ]) {
      store.posts[post.key] = post;
    }
  });
  await publishQueue().add(queueItem(`${id}-a`, at(-10)));
  await publishQueue().add(queueItem(`${id}-b`, at(-7)));
}

describe("experimentReports", () => {
  it("reports nothing, and writes nothing, when no experiment was ever started", async () => {
    expect(await experimentReports(NOW)).toEqual([]);
    await expect(stat(experimentsFile())).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("settles a finished experiment from the analytics store and keeps the decision in the file", async () => {
    await seedFinished("fin1");
    const [report] = await experimentReports(NOW);
    expect(report).toMatchObject({ id: "fin1", status: "decided", winnerId: "A", reason: "winner" });
    const stored = (await readExperiments()).find((entry) => entry.id === "fin1");
    expect(stored?.decision).toMatchObject({ status: "decided", winnerId: "A", decidedAt: NOW.toISOString() });
  });

  it("does not rewrite the file once every experiment has a decision", async () => {
    const before = (await stat(experimentsFile())).mtimeMs;
    const text = await readFile(experimentsFile(), "utf8");
    await experimentReports(new Date(NOW.getTime() + DAY));
    expect((await stat(experimentsFile())).mtimeMs).toBe(before);
    expect(await readFile(experimentsFile(), "utf8")).toBe(text);
  });

  it("lists the newest experiment first and leaves running ones undecided in the file", async () => {
    await updateExperiments((file) => {
      file.experiments.push(
        experiment([variant("A", [{ itemId: "run-a", publishAt: at(3) }]), variant("B", [{ itemId: "run-b", publishAt: at(5) }])], {
          id: "running1",
          createdAt: at(-1)
        })
      );
    });
    await publishQueue().add(queueItem("run-a", at(3), { youtube: "scheduled" }));
    await publishQueue().add(queueItem("run-b", at(5), { youtube: "scheduled" }));

    const reports = await experimentReports(NOW);
    expect(reports.map((entry) => entry.id)).toEqual(["running1", "fin1"]);
    expect(reports[0].status).toBe("running");
    expect((await readExperiments()).find((entry) => entry.id === "running1")?.decision).toBeUndefined();
  });
});
