import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getProject, projectOutputDir } from "@/lib/longform/store";
import { feedProblems } from "@/lib/podcast/feed";
import { feedUrl, podcastConfigured, publishEpisode, refreshFeed } from "@/lib/podcast/publish";
import { readPodcastState, removeEpisode, updateShow } from "@/lib/podcast/store";
import type { PodcastShow } from "@/lib/podcast/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function payload() {
  const state = await readPodcastState();
  return NextResponse.json({
    show: state.show,
    episodes: state.episodes,
    configured: podcastConfigured(),
    feedUrl: feedUrl(),
    problems: feedProblems(state.show, state.episodes)
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
      await publishEpisode({
        filePath: path.join(projectOutputDir(project.id), record.audioFile),
        title: record.title ?? project.metadata?.titles[0] ?? project.name,
        description: project.metadata?.description ?? project.name,
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
