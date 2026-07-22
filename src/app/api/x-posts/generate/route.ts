import { NextRequest, NextResponse } from "next/server";
import { localDateKey } from "@/lib/x-strategy/analytics";
import { generateDailyPack, plannerConfigured } from "@/lib/x-posts/generator";
import { readAppData, writeAppData } from "@/lib/storage/store";

/** Keep two weeks of packs — enough for topic-avoidance, deliberately no longer-term history. */
const PACKS_TO_KEEP = 14;

/**
 * Returns today's X/Threads pack, generating it on first request of the day
 * (or on demand with `force`). The pack is cached in the app data store so the
 * same suggestions stay stable all day across devices. Suggestion-only: this
 * route never records anything about what actually got posted.
 */
export async function POST(request: NextRequest) {
  let focus = "";
  let force = false;
  let requestedAt: string | undefined;
  try {
    const body = (await request.json()) as { focus?: unknown; force?: unknown; requestedAt?: unknown };
    if (typeof body.focus === "string") focus = body.focus;
    force = body.force === true;
    if (typeof body.requestedAt === "string") requestedAt = body.requestedAt;
  } catch {
    // Empty/invalid body is fine — defaults apply.
  }

  const data = await readAppData();
  const today = localDateKey();
  const packs = data.xPlanner?.packs ?? [];

  const existing = packs.find((pack) => pack.date === today);
  if (existing && !force) {
    return NextResponse.json({ pack: existing, cached: true, reason: null, configured: plannerConfigured() });
  }

  // Feed the last two weeks of topics back into the generator — including any
  // pack already written today, so hitting Generate again yields 24 genuinely
  // fresh angles instead of recycling this morning's (repetitive content is
  // both weak brand-building and a spam signal on X/Threads).
  const recentTopics = packs
    .flatMap((pack) => pack.posts.map((post) => post.topic))
    .slice(0, 120);

  const { pack, reason } = await generateDailyPack({
    brief: data.xStrategy.brief,
    date: today,
    focus,
    recentTopics,
    requestedAt: requestedAt ?? new Date().toISOString()
  });

  const nextPacks = [pack, ...packs.filter((entry) => entry.date !== today)].slice(0, PACKS_TO_KEEP);
  await writeAppData({ ...data, xPlanner: { packs: nextPacks } });

  return NextResponse.json({ pack, cached: false, reason, configured: plannerConfigured() });
}
