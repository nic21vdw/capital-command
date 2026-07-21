import { NextResponse } from "next/server";
import { listJobs } from "@/lib/clipping/jobs";
import { listProjects } from "@/lib/longform/store";
import { configuredPlatforms, publisherConfig } from "@/lib/publisher/config";
import { publishQueue } from "@/lib/publisher/queue";
import { readAppData } from "@/lib/storage/store";
import { defaultVideoStudio } from "@/lib/storage/schemas";
import { localDateKey } from "@/lib/x-strategy/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/studio/overview — one call for the Distribution Centre: where
 * every piece of the pipeline stands, from ideas through scripts, edits,
 * outputs (video / audio / carousels / X pack) to the publish queue.
 */
export async function GET() {
  const data = await readAppData();
  const studio = data.videoStudio ?? defaultVideoStudio;

  const [longform, clipJobs] = await Promise.all([
    listProjects().catch(() => []),
    listJobs().catch(() => [])
  ]);

  const config = publisherConfig();
  let queueItems: Array<{ publishAt: string; title: string; platforms: Record<string, { status?: string } | undefined> }> = [];
  if (config.enabled) {
    try {
      queueItems = (await publishQueue(config).list()) as unknown as typeof queueItems;
    } catch {
      queueItems = [];
    }
  }
  const now = new Date().toISOString();
  const platformStates = queueItems.flatMap((item) => Object.values(item.platforms ?? {})).filter(Boolean);
  const nextDue = queueItems
    .filter((item) => item.publishAt >= now)
    .sort((a, b) => a.publishAt.localeCompare(b.publishAt))[0];

  const todayPack = data.xPlanner?.packs.find((pack) => pack.date === localDateKey()) ?? null;

  return NextResponse.json({
    ideas: {
      suggested: studio.ideas.filter((idea) => idea.status === "suggested").length,
      saved: studio.ideas.filter((idea) => idea.status === "saved").length,
      scripted: studio.ideas.filter((idea) => idea.status === "scripted").length
    },
    scripts: {
      draft: studio.scripts.filter((script) => script.status === "draft").length,
      ready: studio.scripts.filter((script) => script.status === "ready").length,
      produced: studio.scripts.filter((script) => script.status === "produced").length,
      latest: studio.scripts.slice(0, 5).map((script) => ({
        id: script.id,
        title: script.title,
        status: script.status,
        updatedAt: script.updatedAt
      }))
    },
    longform: {
      total: longform.length,
      processing: longform.filter((project) => project.status === "processing").length,
      latest: longform.slice(0, 5).map((project) => {
        const doneExport = project.exports.find((record) => record.status === "done" && record.file);
        return {
          id: project.id,
          name: project.name,
          status: project.status,
          hasExport: Boolean(doneExport),
          hasAudio: Boolean(doneExport?.audioFile),
          hasPublishKit: Boolean(project.metadata),
          updatedAt: project.updatedAt
        };
      })
    },
    clips: {
      jobs: clipJobs.length,
      processing: clipJobs.filter((job) => job.status === "processing" || job.status === "queued").length,
      clipsReady: clipJobs.reduce((total, job) => total + job.clips.filter((clip) => clip.file).length, 0)
    },
    carousels: {
      total: studio.carousels.length,
      latest: studio.carousels.slice(0, 3).map((carousel) => ({
        id: carousel.id,
        title: carousel.title,
        slides: carousel.slides.length,
        createdAt: carousel.createdAt
      }))
    },
    xPack: todayPack ? { posts: todayPack.posts.length, replies: todayPack.replies.length, date: todayPack.date } : null,
    publish: {
      enabled: config.enabled,
      configuredPlatforms: configuredPlatforms(config),
      queued: queueItems.length,
      scheduled: platformStates.filter((state) => state?.status === "scheduled" || state?.status === "uploaded").length,
      published: platformStates.filter((state) => state?.status === "published").length,
      manual: platformStates.filter((state) => state?.status === "manual").length,
      failed: platformStates.filter((state) => state?.status === "failed").length,
      nextDue: nextDue ? { title: nextDue.title, publishAt: nextDue.publishAt } : null
    }
  });
}
