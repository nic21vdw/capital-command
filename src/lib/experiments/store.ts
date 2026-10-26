import { readFile } from "node:fs/promises";
import { dataPath } from "@/lib/paths";
import {
  EXPERIMENT_KINDS,
  MAX_VARIANTS,
  MIN_VARIANTS,
  emptyExperiments,
  type Experiment,
  type ExperimentDecision,
  type ExperimentVariant,
  type ExperimentsFile,
  type VariantPlacement,
  type VariantOrigin
} from "@/lib/experiments/types";
import { ALL_PLATFORMS } from "@/lib/publisher/types";
import { atomicWriteJson } from "@/lib/storage/atomic-json";
import { withFileLock } from "@/lib/storage/file-lock";

export function experimentsFile(): string {
  return dataPath("experiments.json");
}

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const ORIGINS: VariantOrigin[] = ["original", "ai", "edited"];

function placement(value: unknown): VariantPlacement | null {
  if (!isRecord(value)) return null;
  const platform = ALL_PLATFORMS.find((candidate) => candidate === value.platform);
  if (!platform || !isString(value.accountId) || !isString(value.itemId) || !isString(value.publishAt)) return null;
  return { platform, accountId: value.accountId, itemId: value.itemId, publishAt: value.publishAt };
}

function variantOf(value: unknown): ExperimentVariant | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.value) || !Array.isArray(value.placements)) return null;
  const placements = value.placements.map(placement);
  if (placements.length === 0 || placements.some((entry) => entry === null)) return null;
  const origin = ORIGINS.find((candidate) => candidate === value.origin) ?? "edited";
  return { id: value.id, value: value.value, origin, placements: placements as VariantPlacement[] };
}

function decisionOf(value: unknown): ExperimentDecision | undefined {
  if (!isRecord(value) || !isString(value.summary) || !isString(value.decidedAt)) return undefined;
  if (value.status !== "decided" && value.status !== "inconclusive") return undefined;
  if (!isString(value.reason)) return undefined;
  return {
    status: value.status,
    reason: value.reason as ExperimentDecision["reason"],
    winnerId: isString(value.winnerId) ? value.winnerId : null,
    summary: value.summary,
    decidedAt: value.decidedAt
  };
}

function experimentOf(value: unknown): Experiment | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.createdAt) || !isRecord(value.source) || !Array.isArray(value.variants)) return null;
  const kind = EXPERIMENT_KINDS.find((candidate) => candidate === value.kind);
  if (!kind || !isString(value.source.label)) return null;
  const variants = value.variants.map(variantOf);
  if (variants.length < MIN_VARIANTS || variants.length > MAX_VARIANTS || variants.some((entry) => entry === null)) return null;
  const windowHours = typeof value.windowHours === "number" && value.windowHours > 0 ? value.windowHours : 72;
  const source = value.source;
  const experiment: Experiment = {
    id: value.id,
    createdAt: value.createdAt,
    kind,
    source: {
      label: source.label as string,
      ...(isString(source.jobId) ? { jobId: source.jobId } : {}),
      ...(isString(source.clipId) ? { clipId: source.clipId } : {}),
      ...(isString(source.file) ? { file: source.file } : {}),
      ...(isString(source.runId) ? { runId: source.runId } : {})
    },
    windowHours,
    variants: variants as ExperimentVariant[]
  };
  const decision = decisionOf(value.decision);
  if (decision) experiment.decision = decision;
  return experiment;
}

export function normalizeExperiments(raw: unknown): ExperimentsFile {
  const file = emptyExperiments();
  if (!isRecord(raw) || !Array.isArray(raw.experiments)) return file;
  for (const entry of raw.experiments) {
    const experiment = experimentOf(entry);
    if (experiment) file.experiments.push(experiment);
  }
  return file;
}

async function readFresh(): Promise<ExperimentsFile> {
  let text: string;
  try {
    text = await readFile(experimentsFile(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyExperiments();
    throw error;
  }
  try {
    return normalizeExperiments(JSON.parse(text));
  } catch (error) {
    throw new Error(
      `experiments.json could not be read (${error instanceof Error ? error.message : String(error)}). Fix or move the file; it was left untouched.`
    );
  }
}

export async function readExperiments(): Promise<Experiment[]> {
  return (await readFresh()).experiments;
}

let queue: Promise<unknown> = Promise.resolve();

export function updateExperiments<T>(mutate: (file: ExperimentsFile) => T | Promise<T>): Promise<T> {
  const run = async () =>
    withFileLock(experimentsFile(), async () => {
      const file = await readFresh();
      const result = await mutate(file);
      await atomicWriteJson(experimentsFile(), file);
      return result;
    });
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
