import { readMetrics } from "@/lib/analytics/store";
import { evaluateExperiment, newDecisions, type ExperimentReport } from "@/lib/experiments/evaluate";
import { readExperiments, updateExperiments } from "@/lib/experiments/store";
import { publishQueue } from "@/lib/publisher/queue";

export async function experimentReports(now: Date = new Date()): Promise<ExperimentReport[]> {
  const experiments = await readExperiments();
  if (experiments.length === 0) return [];

  const [store, queueItems] = await Promise.all([readMetrics(), publishQueue().list()]);
  const posts = Object.values(store.posts);

  const decisions = newDecisions({ experiments, posts, queueItems, now });
  let current = experiments;
  if (decisions.size > 0) {
    current = await updateExperiments((file) => {
      for (const experiment of file.experiments) {
        const decision = decisions.get(experiment.id);
        if (decision && !experiment.decision) experiment.decision = decision;
      }
      return structuredClone(file.experiments);
    });
  }

  return current
    .map((experiment) => evaluateExperiment({ experiment, posts, queueItems, now }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
