import { randomUUID } from "node:crypto";
import { fallbackHashtags } from "@/lib/clipping/hashtags";
import { itemBelongsToAccount, primaryAccountId } from "@/lib/publisher/accounts";
import { publisherConfig } from "@/lib/publisher/config";
import { duplicateQueueMessage, findDuplicateInQueue, normalizeTitle } from "@/lib/publisher/duplicates";
import { enqueue, type EnqueueOptions } from "@/lib/publisher/enqueue";
import { publishQueue } from "@/lib/publisher/queue";
import { assertShortsRoom, shortsLimit } from "@/lib/publisher/shortsCap";
import { generateSlots, slotGrid } from "@/lib/publisher/slots";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";
import { assertVariantSpacing, type Placement } from "@/lib/experiments/spacing";
import { planVariantTimes, type Leg } from "@/lib/experiments/plan";
import { updateExperiments } from "@/lib/experiments/store";
import {
  BOOKABLE_KINDS,
  DEFAULT_WINDOW_HOURS,
  MAX_HOOK_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_VARIANTS,
  MIN_VARIANTS,
  VARIANT_IDS,
  type Experiment,
  type ExperimentKind,
  type ExperimentVariant,
  type VariantOrigin,
  type VariantPlacement
} from "@/lib/experiments/types";

const PLANNING_DAYS = 90;

export class ExperimentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentInputError";
  }
}

export type CreateExperimentInput = {
  kind: ExperimentKind;
  clipPath: string;
  jobId?: string;
  clipId?: string;
  file?: string;
  runId?: string;
  sourceLabel: string;
  baseTitle: string;
  baseCaption?: string;
  hashtags?: string[];
  variants: Array<{ value: string; origin: VariantOrigin }>;
  platforms: PlatformId[];
  accountIds?: Partial<Record<PlatformId, string>>;
};

export type CreateDeps = {
  now: () => Date;
  newId: () => string;
  config: { timezone: string; slotTimes: string[]; weekendSlotTimes: string[]; shortsPerDay?: number };
  listQueue: () => Promise<QueueItem[]>;
  book: (options: EnqueueOptions) => Promise<QueueItem>;
  unbook: (itemId: string) => Promise<void>;
  save: (experiment: Experiment) => Promise<void>;
};

export function defaultCreateDeps(): CreateDeps {
  const config = publisherConfig();
  const queue = publishQueue(config);
  return {
    now: () => new Date(),
    newId: () => randomUUID().slice(0, 8),
    config,
    listQueue: () => queue.list(),
    book: enqueue,
    unbook: async (itemId) => {
      await queue.remove(itemId, "experiment-rollback");
    },
    save: async (experiment) => {
      await updateExperiments((file) => {
        file.experiments.push(experiment);
      });
    }
  };
}

function checkInput(input: CreateExperimentInput): void {
  if (!BOOKABLE_KINDS.includes(input.kind)) {
    throw new ExperimentInputError(
      "Thumbnail tests cannot be booked yet: a scheduled post carries one thumbnail for every variant, so there is nowhere to put a different one. Test the title or the hook."
    );
  }
  if (input.variants.length < MIN_VARIANTS || input.variants.length > MAX_VARIANTS) {
    throw new ExperimentInputError(`A test needs ${MIN_VARIANTS} or ${MAX_VARIANTS} variants, not ${input.variants.length}.`);
  }
  if (input.platforms.length === 0) throw new ExperimentInputError("Choose at least one platform to run the test on.");
  const limit = input.kind === "title" ? MAX_TITLE_LENGTH : MAX_HOOK_LENGTH;
  const seen = new Map<string, string>();
  input.variants.forEach((variant, index) => {
    const id = VARIANT_IDS[index];
    const text = variant.value.trim();
    if (!text) throw new ExperimentInputError(`Variant ${id} is blank. Write something or remove it.`);
    if (text.length > limit) throw new ExperimentInputError(`Variant ${id} is ${text.length} characters and a ${input.kind} can be at most ${limit}.`);
    const key = normalizeTitle(text);
    const twin = seen.get(key);
    if (twin) throw new ExperimentInputError(`Variants ${twin} and ${id} are the same once capitalisation and punctuation are ignored, so there is nothing to compare.`);
    seen.set(key, id);
  });
  if (input.kind === "hook" && input.platforms.includes("youtube")) {
    throw new ExperimentInputError(
      "YouTube will not upload a title it already has up within 30 days, and a hook test keeps the title the same. Take YouTube out of this test, or test titles instead."
    );
  }
}

function titleOf(input: CreateExperimentInput, value: string): string {
  return input.kind === "title" ? value : input.baseTitle;
}

const TITLE_HASHTAG = /#[\p{L}\p{N}_]+/gu;

function bodyCaption(input: CreateExperimentInput): string {
  const given = input.baseCaption?.trim();
  if (given) return given;
  return input.baseTitle.replace(TITLE_HASHTAG, "").replace(/\s{2,}/g, " ").trim() || input.baseTitle;
}

function captionOf(input: CreateExperimentInput, value: string): string {
  return input.kind === "hook" ? `${value}\n\n${bodyCaption(input)}` : bodyCaption(input);
}

function hashtagsOf(input: CreateExperimentInput): string[] {
  return input.hashtags?.length ? input.hashtags : fallbackHashtags({ streamTitle: input.baseTitle });
}

function assertNotAlreadyScheduled(input: CreateExperimentInput, queue: QueueItem[]): void {
  const titles = input.variants.map((variant) => titleOf(input, variant.value.trim()));
  for (const title of new Set(titles)) {
    const duplicate = findDuplicateInQueue({ paths: [input.clipPath], jobId: input.jobId, title }, queue);
    if (duplicate) {
      throw new ExperimentInputError(
        `${duplicateQueueMessage(duplicate)} A test can only start from a clip that is not scheduled yet, so the variants are the only copies of it.`
      );
    }
  }
}

function legsOf(input: CreateExperimentInput): Leg[] {
  return input.platforms.map((platform) => ({ platform, accountId: input.accountIds?.[platform] ?? primaryAccountId(platform) }));
}

export async function createExperiment(input: CreateExperimentInput, deps: CreateDeps = defaultCreateDeps()): Promise<{ experiment: Experiment; items: QueueItem[] }> {
  checkInput(input);
  const now = deps.now();
  const queue = await deps.listQueue();
  assertNotAlreadyScheduled(input, queue);

  const legs = legsOf(input);
  const slots = generateSlots({ timeZone: deps.config.timezone, days: PLANNING_DAYS, now, ...slotGrid(deps.config) });
  const limit = shortsLimit(deps.config);
  const times = planVariantTimes({
    count: input.variants.length,
    slots,
    legs,
    taken: (leg, utc) => queue.some((item) => Date.parse(item.publishAt) === Date.parse(utc) && itemBelongsToAccount(item, leg.platform, leg.accountId)),
    usable: (utc) => {
      try {
        assertShortsRoom(queue, utc, deps.config.timezone, limit, input.clipPath);
        return true;
      } catch {
        return false;
      }
    }
  });

  const planned: Placement[] = [];
  input.variants.forEach((_, index) => {
    for (const leg of legs) planned.push({ variantId: VARIANT_IDS[index], platform: leg.platform, accountId: leg.accountId, at: times[index] });
  });
  assertVariantSpacing(planned);

  const booked: QueueItem[] = [];
  const variants: ExperimentVariant[] = [];
  try {
    for (const [index, variant] of input.variants.entries()) {
      const placements: VariantPlacement[] = [];
      const value = variant.value.trim();
      for (const leg of legs) {
        const item = await deps.book({
          clipPath: input.clipPath,
          publishAt: times[index],
          title: titleOf(input, value),
          caption: captionOf(input, value),
          hashtags: hashtagsOf(input),
          platforms: [leg.platform],
          visibility: "public",
          jobId: input.jobId,
          runId: input.runId,
          accountId: input.accountIds?.[leg.platform],
          format: "short",
          allowDuplicate: booked.length > 0 ? true : undefined,
          by: "experiment-book"
        });
        booked.push(item);
        placements.push({ platform: leg.platform, accountId: leg.accountId, itemId: item.id, publishAt: item.publishAt });
      }
      variants.push({ id: VARIANT_IDS[index], value, origin: variant.origin, placements });
    }
  } catch (error) {
    for (const item of booked) await deps.unbook(item.id).catch(() => undefined);
    throw error;
  }

  const experiment: Experiment = {
    id: deps.newId(),
    createdAt: now.toISOString(),
    kind: input.kind,
    source: {
      label: input.sourceLabel,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      ...(input.clipId ? { clipId: input.clipId } : {}),
      ...(input.file ? { file: input.file } : {}),
      ...(input.runId ? { runId: input.runId } : {})
    },
    windowHours: DEFAULT_WINDOW_HOURS,
    variants
  };
  try {
    await deps.save(experiment);
  } catch (error) {
    for (const item of booked) await deps.unbook(item.id).catch(() => undefined);
    throw error;
  }
  return { experiment, items: booked };
}
