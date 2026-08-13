import { describe, expect, it } from "vitest";
import { adoptedItem, adoptedItemId, unknownChannelVideos } from "@/lib/publisher/adoptChannelVideos";
import type { ChannelVideo } from "@/lib/publisher/channelVideos";
import { newPlatformState } from "@/lib/publisher/queue";
import { findDuplicateInQueue } from "@/lib/publisher/duplicates";
import type { QueueItem } from "@/lib/publisher/types";

const NOW = new Date("2026-08-12T16:00:00.000Z");

function video(videoId: string, status: ChannelVideo["status"], publishAtUtc: string): ChannelVideo {
  return {
    videoId,
    title: `${videoId} title`,
    status,
    publishAtUtc,
    thumbnailUrl: null,
    url: `https://www.youtube.com/watch?v=${videoId}`
  };
}

function item(id: string, postId?: string): QueueItem {
  return {
    id,
    clipPath: `data/clips/${id}.mp4`,
    title: id,
    caption: id,
    hashtags: [],
    publishAt: "2026-08-20T11:30:00.000Z",
    visibility: "public",
    createdAt: "2026-08-01T00:00:00.000Z",
    platforms: { youtube: { ...newPlatformState(), postId } }
  };
}

describe("finding videos the queue never recorded", () => {
  it("keeps only the ones no queue item claims", () => {
    const videos = [video("known", "scheduled", "2026-08-13T11:30:00.000Z"), video("orphan", "scheduled", "2026-08-14T11:30:00.000Z")];
    const unknown = unknownChannelVideos(videos, [item("a", "known"), item("b")]);
    expect(unknown.map((entry) => entry.videoId)).toEqual(["orphan"]);
  });

  it("stops claiming it once it has been adopted", () => {
    const orphan = video("orphan", "scheduled", "2026-08-14T11:30:00.000Z");
    const adopted = adoptedItem(orphan, NOW);
    expect(unknownChannelVideos([orphan], [adopted])).toEqual([]);
  });
});

describe("the record an adoption writes", () => {
  it("takes the video's own time, and only YouTube", () => {
    const adopted = adoptedItem(video("abc", "scheduled", "2026-08-14T11:30:00.000Z"), NOW);
    expect(adopted.id).toBe(adoptedItemId("abc"));
    expect(adopted.publishAt).toBe("2026-08-14T11:30:00.000Z");
    expect(Object.keys(adopted.platforms)).toEqual(["youtube"]);
  });

  it("carries the video id, which is what stops the runner uploading anything", () => {
    const adopted = adoptedItem(video("abc", "scheduled", "2026-08-14T11:30:00.000Z"), NOW);
    expect(adopted.platforms.youtube?.postId).toBe("abc");
    expect(adopted.platforms.youtube?.status).toBe("scheduled");
  });

  it("records a video that is already live as published, not as work to do", () => {
    const adopted = adoptedItem(video("abc", "published", "2026-08-11T11:30:00.000Z"), NOW);
    expect(adopted.platforms.youtube?.status).toBe("published");
    expect(adopted.platforms.youtube?.publishedAt).toBe("2026-08-11T11:30:00.000Z");
  });

  it("is the same record twice, so adopting again does not add a second one", () => {
    const orphan = video("abc", "scheduled", "2026-08-14T11:30:00.000Z");
    expect(adoptedItem(orphan, NOW).id).toBe(adoptedItem(orphan, new Date("2026-09-01T00:00:00.000Z")).id);
  });

  it("has no file path, so it cannot look like a duplicate of a real post", () => {
    const adopted = adoptedItem(video("abc", "scheduled", "2026-08-14T11:30:00.000Z"), NOW);
    expect(adopted.clipPath).toBe("");
    expect(
      findDuplicateInQueue({ paths: ["data/clips/real.mp4"], jobId: "job-1", title: "abc title" }, [adopted])
    ).toBeUndefined();
  });
});
