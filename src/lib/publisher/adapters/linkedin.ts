import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { buildCarouselPdf } from "@/lib/carousels/pdf";
import { publisherConfig } from "@/lib/publisher/config";
import { PermanentError, StillProcessingError, fetchJson } from "@/lib/publisher/http";
import { IMAGE_CONTENT_TYPES, imagePathsOf, isImagePost } from "@/lib/publisher/images";
import {
  LINKEDIN_API_ORIGIN,
  LINKEDIN_REST,
  linkedinCall,
  linkedinJson,
  linkedinUpload,
  littleText
} from "@/lib/publisher/linkedinApi";
import { linkedinAccessToken, linkedinSession } from "@/lib/publisher/linkedinAuth";
import { LINKEDIN_PAGE_SCOPE } from "@/lib/publisher/linkedinKeys";
import { composeCaption } from "@/lib/publisher/metadata";
import { formatInTimezone, toRfc3339Utc } from "@/lib/publisher/time";
import type { PlatformAdapter, PostResult, PublishInput, PublishPlan, Visibility } from "@/lib/publisher/types";

const POLL_INTERVAL_MS = 5_000;
const IMAGE_POLL_BUDGET_MS = 20_000;
const DOCUMENT_POLL_BUDGET_MS = 60_000;
const VIDEO_POLL_BUDGET_MS = 120_000;
const TITLE_LIMIT = 100;

type MediaKind = "image" | "document" | "video";

type Session = { token: string; author: string; scopes: string[] };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MEDIA_ENDPOINT: Record<MediaKind, string> = {
  image: "images",
  document: "documents",
  video: "videos"
};

const MEDIA_URN_PREFIX: Record<MediaKind, string> = {
  image: "urn:li:image:",
  document: "urn:li:document:",
  video: "urn:li:video:"
};

function isPage(author: string): boolean {
  return author.startsWith("urn:li:organization:");
}

function assertCanPost(session: Session, visibility: Visibility): "PUBLIC" | "CONNECTIONS" {
  if (isPage(session.author) && !session.scopes.includes(LINKEDIN_PAGE_SCOPE)) {
    throw new PermanentError(
      `Posting as a LinkedIn page needs the ${LINKEDIN_PAGE_SCOPE} permission, which this sign-in does not have. ` +
        "Add the Community Management API to the LinkedIn app, then reconnect LinkedIn with company pages enabled."
    );
  }
  if (visibility === "public") return "PUBLIC";
  if (isPage(session.author)) {
    throw new PermanentError(
      "LinkedIn page posts are always public. Set this post's visibility to public and schedule it again."
    );
  }
  return "CONNECTIONS";
}

function mediaKindOf(input: PublishInput): MediaKind {
  if (!isImagePost(input.item)) return "video";
  return imageFiles(input).length > 1 ? "document" : "image";
}

function imageFiles(input: PublishInput): string[] {
  if (input.images?.localPaths.length) return input.images.localPaths;
  return imagePathsOf(input.item).map((entry) => (path.isAbsolute(entry) ? entry : path.join(process.cwd(), entry)));
}

function mediaTitle(input: PublishInput): string {
  return input.item.title.trim().slice(0, TITLE_LIMIT) || "CoLateral";
}

async function assetStatus(session: Session, kind: MediaKind, urn: string): Promise<string> {
  const detail = await linkedinJson<{ status?: string }>(`${LINKEDIN_REST}/${MEDIA_ENDPOINT[kind]}/${encodeURIComponent(urn)}`, {
    token: session.token,
    label: `LinkedIn ${kind} status`
  });
  return detail.status ?? "UNKNOWN";
}

async function waitForAsset(session: Session, kind: MediaKind, urn: string, budgetMs: number): Promise<void> {
  const started = Date.now();
  for (;;) {
    const status = await assetStatus(session, kind, urn);
    if (status === "AVAILABLE") return;
    if (status === "PROCESSING_FAILED") {
      throw new PermanentError(`LinkedIn could not process the ${kind} (PROCESSING_FAILED). Check the file format and size limits.`);
    }
    if (Date.now() - started >= budgetMs) {
      throw new StillProcessingError(urn, `LinkedIn is still processing the ${kind} - will resume on the next run.`);
    }
    await wait(POLL_INTERVAL_MS);
  }
}

async function uploadSingle(session: Session, kind: "image" | "document", bytes: Buffer, contentType: string): Promise<string> {
  const init = await linkedinJson<{ value?: { uploadUrl?: string; image?: string; document?: string } }>(
    `${LINKEDIN_REST}/${MEDIA_ENDPOINT[kind]}?action=initializeUpload`,
    {
      method: "POST",
      token: session.token,
      label: `LinkedIn ${kind} upload start`,
      body: { initializeUploadRequest: { owner: session.author } }
    }
  );
  const urn = init.value?.[kind];
  const uploadUrl = init.value?.uploadUrl;
  if (!urn || !uploadUrl) throw new PermanentError(`LinkedIn ${kind} upload start returned no upload URL.`);
  await linkedinUpload(uploadUrl, {
    body: bytes,
    headers: { Authorization: `Bearer ${session.token}`, "Content-Type": contentType },
    label: `LinkedIn ${kind} upload`
  });
  return urn;
}

async function uploadVideo(session: Session, filePath: string): Promise<string> {
  const size = (await stat(filePath)).size;
  const init = await linkedinJson<{
    value?: {
      video?: string;
      uploadToken?: string;
      uploadInstructions?: Array<{ uploadUrl: string; firstByte: number; lastByte: number }>;
    };
  }>(`${LINKEDIN_REST}/videos?action=initializeUpload`, {
    method: "POST",
    token: session.token,
    label: "LinkedIn video upload start",
    body: { initializeUploadRequest: { owner: session.author, fileSizeBytes: size, uploadCaptions: false, uploadThumbnail: false } }
  });
  const urn = init.value?.video;
  const instructions = init.value?.uploadInstructions ?? [];
  if (!urn || instructions.length === 0) throw new PermanentError("LinkedIn video upload start returned no upload instructions.");

  const partIds: string[] = [];
  const handle = await open(filePath, "r");
  try {
    for (const [index, part] of instructions.entries()) {
      const length = part.lastByte - part.firstByte + 1;
      const chunk = Buffer.alloc(length);
      const { bytesRead } = await handle.read(chunk, 0, length, part.firstByte);
      const response = await linkedinUpload(part.uploadUrl, {
        body: chunk.subarray(0, bytesRead),
        headers: { "Content-Type": "application/octet-stream" },
        label: `LinkedIn video upload (part ${index + 1} of ${instructions.length})`
      });
      const etag = response.headers.get("etag");
      if (!etag) throw new PermanentError(`LinkedIn video part ${index + 1} was accepted without an ETag, so the upload cannot be finalised.`);
      partIds.push(etag);
    }
  } finally {
    await handle.close();
  }

  await linkedinCall(`${LINKEDIN_REST}/videos?action=finalizeUpload`, {
    method: "POST",
    token: session.token,
    label: "LinkedIn video upload finish",
    body: { finalizeUploadRequest: { video: urn, uploadToken: init.value?.uploadToken ?? "", uploadedPartIds: partIds } }
  });
  return urn;
}

async function uploadMedia(session: Session, kind: MediaKind, input: PublishInput): Promise<string> {
  if (kind === "video") return uploadVideo(session, input.localPath);
  if (kind === "document") {
    const pdf = await buildCarouselPdf(imageFiles(input), { title: mediaTitle(input) });
    return uploadSingle(session, "document", pdf, "application/pdf");
  }
  const [file] = imageFiles(input);
  const contentType = IMAGE_CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  return uploadSingle(session, "image", await readFile(file), contentType);
}

type PostContent =
  | { media: { title: string; id: string } }
  | { article: { source: string; title: string; description?: string } };

async function createPost(session: Session, commentary: string, visibility: string, content?: PostContent): Promise<string> {
  const response = await linkedinCall(`${LINKEDIN_REST}/posts`, {
    method: "POST",
    token: session.token,
    label: "LinkedIn post",
    body: {
      author: session.author,
      commentary,
      visibility,
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      ...(content ? { content } : {}),
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false
    }
  });
  const id = response.headers.get("x-restli-id");
  if (!id) {
    throw new PermanentError(
      "LinkedIn created the post but returned no post id, so it cannot be tracked. Check your LinkedIn feed before scheduling it again."
    );
  }
  return id;
}

export async function publishLinkedinText(input: {
  text: string;
  link?: { url: string; title: string; description?: string };
  visibility?: Visibility;
}): Promise<PostResult> {
  const session = await linkedinSession();
  const visibility = assertCanPost(session, input.visibility ?? "public");
  const content: PostContent | undefined = input.link
    ? {
        article: {
          source: input.link.url,
          title: input.link.title,
          ...(input.link.description ? { description: input.link.description } : {})
        }
      }
    : undefined;
  const postId = await createPost(session, littleText(input.text), visibility, content);
  return { status: "published", postId, detail: input.link ? "text post with a link published" : "text post published" };
}

function budgetFor(kind: MediaKind, input: PublishInput): number {
  if (kind === "video") return input.pollBudgetMs ?? VIDEO_POLL_BUDGET_MS;
  return kind === "document" ? DOCUMENT_POLL_BUDGET_MS : IMAGE_POLL_BUDGET_MS;
}

const DETAIL: Record<MediaKind, string> = {
  image: "image post published",
  document: "carousel published as a PDF document",
  video: "video published"
};

export const linkedinAdapter: PlatformAdapter = {
  id: "linkedin",

  configured(): boolean {
    const { linkedin } = publisherConfig();
    return Boolean(
      linkedin.clientId && linkedin.clientSecret && (linkedin.accessToken || linkedin.refreshToken) && linkedin.authorUrn
    );
  },

  async validateAuth(): Promise<void> {
    const token = await linkedinAccessToken();
    await fetchJson(`${LINKEDIN_API_ORIGIN}/v2/userinfo`, {
      label: "LinkedIn auth check",
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
  },

  buildPlan(input: PublishInput): PublishPlan {
    const config = publisherConfig();
    const publishAt = new Date(input.item.publishAt);
    const kind = mediaKindOf(input);
    const pages = kind === "document" ? imageFiles(input).length : undefined;
    return {
      platform: "linkedin",
      endpoint: `${LINKEDIN_REST}/${MEDIA_ENDPOINT[kind]}?action=initializeUpload → ${LINKEDIN_REST}/posts`,
      payload: {
        author: config.linkedin.authorUrn ?? "<member or page chosen in Settings > Accounts>",
        commentary: composeCaption(input.item, "linkedin").slice(0, 3000),
        visibility: input.item.visibility === "public" ? "PUBLIC" : "CONNECTIONS",
        media: kind,
        ...(pages ? { pages } : {})
      },
      publishAtUtc: toRfc3339Utc(publishAt),
      publishAtLocal: formatInTimezone(publishAt, config.timezone),
      notes: [
        "No native scheduling - the runner fires this at the target time.",
        kind === "document"
          ? "A multi-slide carousel is rendered into one PDF and posted as a document."
          : "The media is uploaded to LinkedIn directly, so no media hosting is needed.",
        "A rate limit (HTTP 429) defers the post until LinkedIn's daily limits reset at midnight UTC."
      ]
    };
  },

  async publish(input: PublishInput): Promise<PostResult> {
    const session = await linkedinSession();
    const visibility = assertCanPost(session, input.item.visibility);
    const commentary = littleText(composeCaption(input.item, "linkedin") || input.item.title);
    const kind = mediaKindOf(input);

    const handle = input.item.platforms.linkedin?.containerId;
    let mediaUrn = handle?.startsWith(MEDIA_URN_PREFIX[kind]) ? handle : undefined;
    if (!mediaUrn) {
      mediaUrn = await uploadMedia(session, kind, input);
      await input.onHandle?.(mediaUrn);
    }
    await waitForAsset(session, kind, mediaUrn, budgetFor(kind, input));

    const postId = await createPost(session, commentary, visibility, { media: { title: mediaTitle(input), id: mediaUrn } });
    return { status: "published", postId, containerId: mediaUrn, detail: DETAIL[kind] };
  }
};
