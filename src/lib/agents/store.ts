import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import type { AgentRun } from "@/lib/agents/types";

const runsPath = dataPath("agents", "runs.json");
let writeQueue = Promise.resolve();
const reviewQueues = new Map<string, Promise<void>>();

/** Review one run at a time, including its action's side effect and save. */
export async function withAgentRunReview<T>(runId: string, review: () => Promise<T>): Promise<T> {
  const pending = (reviewQueues.get(runId) ?? Promise.resolve()).then(review, review);
  const settled = pending.then(() => undefined, () => undefined);
  reviewQueues.set(runId, settled);
  try {
    return await pending;
  } finally {
    if (reviewQueues.get(runId) === settled) reviewQueues.delete(runId);
  }
}

export async function listAgentRuns(): Promise<AgentRun[]> {
  try {
    const parsed = JSON.parse(await readFile(runsPath, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as AgentRun[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("[agents] could not read run history");
    return [];
  }
}

async function writeRunsNow(runs: AgentRun[]) {
  await mkdir(path.dirname(runsPath), { recursive: true });
  const tmp = `${runsPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(runs.slice(0, 50), null, 2), "utf8");
  try {
    await rename(tmp, runsPath);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

export async function saveAgentRun(run: AgentRun): Promise<AgentRun> {
  const save = async () => {
    const runs = await listAgentRuns();
    await writeRunsNow([run, ...runs.filter((item) => item.id !== run.id)]);
  };
  writeQueue = writeQueue.then(save, save);
  await writeQueue;
  return run;
}

export async function getAgentRun(id: string): Promise<AgentRun | null> {
  return (await listAgentRuns()).find((run) => run.id === id) ?? null;
}
