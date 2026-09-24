import { open, stat } from "node:fs/promises";
import { assertPrivate, STORY_PRIVACY, storyStatus } from "@/lib/story/privacy";

const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const CAPTIONS_URL = "https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet";
const CHUNK_BYTES = 32 * 1024 * 1024;
const MAX_ATTEMPTS = 8;

export type Fetcher = typeof fetch;

export type StoryUploadInput = {
  file: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  language: string;
  madeForKids: boolean;
  accessToken: () => Promise<string>;
  resumeUrl?: string;
  onSession?: (url: string) => Promise<void> | void;
  onProgress?: (sent: number, total: number) => void;
  fetcher?: Fetcher;
  sleep?: (ms: number) => Promise<void>;
};

export type StoryVideoBody = {
  snippet: {
    title: string;
    description: string;
    tags: string[];
    categoryId: string;
    defaultLanguage: string;
    defaultAudioLanguage: string;
  };
  status: ReturnType<typeof storyStatus>;
};

export function storyVideoBody(input: Pick<StoryUploadInput, "title" | "description" | "tags" | "categoryId" | "language" | "madeForKids">): StoryVideoBody {
  const body: StoryVideoBody = {
    snippet: {
      title: input.title.slice(0, 100),
      description: input.description.slice(0, 5000),
      tags: fitTags(input.tags),
      categoryId: input.categoryId,
      defaultLanguage: input.language,
      defaultAudioLanguage: input.language
    },
    status: storyStatus(input.madeForKids)
  };
  assertPrivate(body);
  return body;
}

export function fitTags(tags: string[], budget = 480): string[] {
  const out: string[] = [];
  let used = 0;
  for (const raw of tags) {
    const tag = raw.replace(/^#/, "").replace(/[<>]/g, "").trim();
    if (!tag || out.includes(tag)) continue;
    const cost = tag.length + (tag.includes(" ") ? 2 : 0) + (out.length ? 1 : 0);
    if (used + cost > budget) break;
    out.push(tag);
    used += cost;
  }
  return out;
}

export function backoffMs(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
}

function retriable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function startSession(input: StoryUploadInput, size: number, fetcher: Fetcher): Promise<string> {
  const body = storyVideoBody(input);
  const response = await fetcher(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await input.accessToken()}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(size),
      "X-Upload-Content-Type": "video/mp4"
    },
    body: JSON.stringify(body)
  });
  const location = response.headers.get("location");
  if (!response.ok || !location) throw new UploadError(`Could not start the upload (${response.status}): ${await response.text()}`, retriable(response.status));
  return location;
}

class UploadError extends Error {
  constructor(message: string, readonly retry: boolean) {
    super(message);
  }
}

async function committedBytes(url: string, size: number, input: StoryUploadInput, fetcher: Fetcher): Promise<number | { id: string }> {
  const response = await fetcher(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${await input.accessToken()}`, "Content-Range": `bytes */${size}`, "Content-Length": "0" }
  });
  if (response.status === 200 || response.status === 201) return { id: ((await response.json()) as { id: string }).id };
  if (response.status === 308) {
    const range = response.headers.get("range");
    return range ? Number(range.split("-")[1]) + 1 : 0;
  }
  if (response.status === 404 || response.status === 410) throw new UploadError("The upload session expired.", false);
  throw new UploadError(`Could not read upload progress (${response.status}).`, retriable(response.status));
}

export async function uploadStoryVideo(input: StoryUploadInput): Promise<{ videoId: string; sessionUrl: string }> {
  const fetcher = input.fetcher ?? fetch;
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const size = (await stat(input.file)).size;
  let sessionUrl = input.resumeUrl ?? "";
  let offset = 0;
  let attempt = 0;
  const handle = await open(input.file, "r");
  try {
    if (sessionUrl) {
      try {
        const state = await committedBytes(sessionUrl, size, input, fetcher);
        if (typeof state !== "number") return { videoId: state.id, sessionUrl };
        offset = state;
      } catch {
        sessionUrl = "";
      }
    }
    if (!sessionUrl) {
      sessionUrl = await startSession(input, size, fetcher);
      await input.onSession?.(sessionUrl);
    }
    while (true) {
      const length = Math.min(CHUNK_BYTES, size - offset);
      const chunk = Buffer.alloc(length);
      await handle.read(chunk, 0, length, offset);
      try {
        const response = await fetcher(sessionUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${await input.accessToken()}`,
            "Content-Length": String(length),
            "Content-Range": `bytes ${offset}-${offset + length - 1}/${size}`
          },
          body: chunk
        });
        if (response.status === 200 || response.status === 201) {
          const video = (await response.json()) as { id: string; status?: { privacyStatus?: string } };
          return { videoId: video.id, sessionUrl };
        }
        if (response.status === 308) {
          const range = response.headers.get("range");
          offset = range ? Number(range.split("-")[1]) + 1 : 0;
          attempt = 0;
          input.onProgress?.(offset, size);
          continue;
        }
        throw new UploadError(`Upload chunk failed (${response.status}): ${(await response.text()).slice(0, 300)}`, retriable(response.status));
      } catch (error) {
        const retry = !(error instanceof UploadError) || error.retry;
        if (!retry || ++attempt > MAX_ATTEMPTS) throw error;
        await sleep(backoffMs(attempt));
        const state = await committedBytes(sessionUrl, size, input, fetcher).catch(() => offset);
        if (typeof state !== "number") return { videoId: state.id, sessionUrl };
        offset = state;
      }
    }
  } finally {
    await handle.close();
  }
}

export async function uploadCaptions(input: {
  videoId: string;
  srt: string;
  language: string;
  name: string;
  accessToken: () => Promise<string>;
  fetcher?: Fetcher;
}): Promise<string> {
  const fetcher = input.fetcher ?? fetch;
  const boundary = `story${Date.now()}`;
  const metadata = JSON.stringify({ snippet: { videoId: input.videoId, language: input.language, name: input.name, isDraft: false } });
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    metadata,
    `--${boundary}`,
    "Content-Type: application/octet-stream",
    "",
    input.srt,
    `--${boundary}--`,
    ""
  ].join("\r\n");
  let attempt = 0;
  while (true) {
    const response = await fetcher(CAPTIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${await input.accessToken()}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body
    });
    if (response.ok) return ((await response.json()) as { id: string }).id;
    if (!retriable(response.status) || ++attempt > 4) throw new Error(`Caption upload failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
  }
}

export type VideoReadback = { id: string; privacyStatus: string; title: string; description: string; processingStatus?: string };

export async function readBackVideo(videoId: string, accessToken: () => Promise<string>, fetcher: Fetcher = fetch): Promise<VideoReadback> {
  const response = await fetcher(`${VIDEOS_URL}?part=status,snippet,processingDetails&id=${encodeURIComponent(videoId)}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` }
  });
  if (!response.ok) throw new Error(`videos.list failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const data = (await response.json()) as {
    items?: Array<{ id: string; status: { privacyStatus: string }; snippet: { title: string; description: string }; processingDetails?: { processingStatus?: string } }>;
  };
  const item = data.items?.[0];
  if (!item) throw new Error(`videos.list returned nothing for ${videoId}.`);
  return {
    id: item.id,
    privacyStatus: item.status.privacyStatus,
    title: item.snippet.title,
    description: item.snippet.description,
    processingStatus: item.processingDetails?.processingStatus
  };
}

export function verifyPrivate(readback: VideoReadback): void {
  if (readback.privacyStatus !== STORY_PRIVACY) {
    throw new Error(`YouTube reports ${readback.id} as "${readback.privacyStatus}", not private.`);
  }
}

export function studioLink(videoId: string): string {
  return `https://studio.youtube.com/video/${videoId}/edit`;
}
