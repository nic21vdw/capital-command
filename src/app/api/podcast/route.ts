import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { generateLongformMetadata, longformMetadataConfigured } from "@/lib/longform/metadata";
import { getProject, listProjects, projectOutputDir, updateProject } from "@/lib/longform/store";
import type { LongformProject } from "@/lib/longform/types";
import { episodeCandidates } from "@/lib/podcast/candidates";
import { feedBlockers } from "@/lib/podcast/feed";
import { feedUrl, podcastConfigured, publishEpisode, refreshFeed } from "@/lib/podcast/publish";
import { readPodcastState, removeEpisode, updateShow } from "@/lib/podcast/store";
import type { PodcastShow } from "@/lib/podcast/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function payload() {
  const state = await readPodcastState();
  const configured = podcastConfigured();
  return NextResponse.json({
    show: state.show,
    episodes: state.episodes,
    configured,
    feedUrl: feedUrl(),
    blockers: feedBlockers(state.show, state.episodes, { hosted: configured }),
    candidates: episodeCandidates(await listProjects(), state.episodes)
  });
}

export async function GET() {
  return payload();
}

const SHOW_FIELDS: (keyof PodcastShow)[] = [
  "title",
  "description",
  "author",
  "email",
  "link",
  "language",
  "category",
  "explicit",
  "artworkUrl",
  "copyright"
];

/**
 * Show notes for the episode. The pipeline publishes before anything has
 * written metadata, which is how episodes ended up described by the raw stream
 * name; publishing by hand is a good moment to spend the one Claude call, and
 * it is kept on the project so the video side gets it too.
 */
async function episodeMetadata(project: LongformProject) {
  if (project.metadata) return project.metadata;
  if (!longformMetadataConfigured()) return undefined;
  const metadata = await generateLongformMetadata(project);
  await updateProject(project.id, { metadata });
  return metadata;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");

  try {
    if (action === "save-show") {
      const patch: Partial<PodcastShow> = {};
      for (const field of SHOW_FIELDS) {
        const value = (body.show as Record<string, unknown> | undefined)?.[field];
        if (value === undefined) continue;
        if (field === "explicit") patch.explicit = Boolean(value);
        else patch[field] = String(value) as never;
      }
      const state = await updateShow(patch);
      // Only republish once there is a feed worth republishing — a save before
      // hosting is set up should still keep the details.
      if (podcastConfigured()) await refreshFeed(state);
      return payload();
    }

    if (action === "refresh") {
      await refreshFeed();
      return payload();
    }

    if (action === "publish-export") {
      const projectId = String(body.projectId ?? "");
      const exportId = String(body.exportId ?? "");
      const project = await getProject(projectId);
      const record = project?.exports.find((item) => item.id === exportId);
      if (!project || !record) {
        return NextResponse.json({ error: "That long-form export could not be found." }, { status: 404 });
      }
      if (!record.audioFile) {
        return NextResponse.json(
          { error: "Cut the audio version of this export first — the episode is the MP3." },
          { status: 409 }
        );
      }
      const metadata = await episodeMetadata(project);
      await publishEpisode({
        filePath: path.join(projectOutputDir(project.id), record.audioFile),
        title: record.title ?? metadata?.titles[0] ?? project.name,
        description: metadata?.description ?? project.name,
        durationSec: record.durationSec ?? 0,
        projectId: project.id,
        exportId: record.id
      });
      return payload();
    }

    if (action === "remove-episode") {
      const state = await removeEpisode(String(body.episodeId ?? ""));
      if (podcastConfigured()) await refreshFeed(state);
      return payload();
    }

    return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
