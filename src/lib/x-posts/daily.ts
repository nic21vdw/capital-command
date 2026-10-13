import { generateDailyPack } from "@/lib/x-posts/generator";
import { readAppData, writeAppData } from "@/lib/storage/store";
import { localDateKey } from "@/lib/x-strategy/analytics";
import type { XDailyPack } from "@/types/domain";

/**
 * Today's pack, generated on first ask of the day and cached in the app data
 * store so the same suggestions stay stable across devices. Shared by the
 * X/Threads page (POST /api/x-posts/generate) and the Threads autopilot, which
 * needs exactly the same "one fresh pack per day" behaviour and must not grow
 * a second copy of the caching rules.
 */

/** Two weeks of packs — enough for topic-avoidance, deliberately no history beyond that. */
const PACKS_TO_KEEP = 14;

export type EnsurePackResult = {
  pack: XDailyPack;
  cached: boolean;
  /** Why the pack came from the idea library instead of the model, when it did. */
  reason: string | null;
};

export async function ensureDailyPack(
  options: {
    focus?: string;
    force?: boolean;
    requestedAt?: string;
    date?: string;
    /**
     * With `force`: never swap a model-written pack for the idea-library fallback.
     * A rewrite that cannot reach the model would otherwise replace six written
     * posts with twenty-four stock ones; the written pack stays and the reason is
     * returned so the page can say why nothing changed.
     */
    keepWritten?: boolean;
  } = {}
): Promise<EnsurePackResult> {
  const data = await readAppData();
  const today = options.date ?? localDateKey();
  const packs = data.xPlanner?.packs ?? [];

  const existing = packs.find((pack) => pack.date === today);
  if (existing && !options.force) return { pack: existing, cached: true, reason: null };

  // Feed the last two weeks of topics back in — including any pack already
  // written today, so a forced regeneration yields genuinely fresh angles
  // instead of recycling this morning's (repetition is both weak brand-building
  // and a spam signal on X/Threads).
  const recentTopics = packs.flatMap((pack) => pack.posts.map((post) => post.topic)).slice(0, 120);

  const { pack, reason } = await generateDailyPack({
    brief: data.xStrategy.brief,
    date: today,
    focus: options.focus ?? "",
    recentTopics,
    requestedAt: options.requestedAt ?? new Date().toISOString()
  });

  if (options.force && options.keepWritten && existing?.source === "ai" && pack.source === "library") {
    return {
      pack: existing,
      cached: true,
      reason: `Kept today's pack: ${reason ?? "the new one could only come from the built-in idea library."} Try the rewrite again once AI is available.`
    };
  }

  const nextPacks = [pack, ...packs.filter((entry) => entry.date !== today)].slice(0, PACKS_TO_KEEP);
  await writeAppData({ ...data, xPlanner: { packs: nextPacks } });

  return { pack, cached: false, reason };
}
