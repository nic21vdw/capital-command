import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isAuthFailure } from "@/lib/platform-health/auth";
import { dataPath } from "@/lib/paths";
import { postCode } from "@/lib/attribution/code";
import { LINKEDIN_KEYS } from "@/lib/publisher/linkedinKeys";
import { jsonResponse, mockFetchRoutes, testItem, type RecordedRequest } from "@/lib/publisher/test-helpers";
import type { PlatformHealthResponse } from "@/lib/platform-health/types";
import type { PublishInput } from "@/lib/publisher/types";

const MEMBER = "urn:li:person:abc123";
const PAGE = "urn:li:organization:99";
const DAY = 86_400_000;
const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let dir: string;
let videoPath: string;
let imagePaths: string[];

beforeAll(async () => {
  dir = path.join(os.tmpdir(), `publisher-li-test-${process.pid}`);
  await mkdir(dir, { recursive: true });
  videoPath = path.join(dir, "clip.mp4");
  await writeFile(videoPath, Buffer.from("0123456789"));
  imagePaths = [];
  for (const index of [1, 2, 3]) {
    const file = path.join(dir, `slide-${index}.png`);
    await writeFile(file, Buffer.from(ONE_PIXEL_PNG, "base64"));
    imagePaths.push(file);
  }
});

beforeEach(async () => {
  await rm(dataPath("publisher-tokens.json"), { force: true });
  await rm(dataPath("platform-auth.json"), { force: true });
  vi.stubEnv("LINKEDIN_CLIENT_ID", "li-client");
  vi.stubEnv("LINKEDIN_CLIENT_SECRET", "li-secret");
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/carousels/pdf");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const http = () => import("@/lib/publisher/http");

async function adapter() {
  return (await import("@/lib/publisher/adapters/linkedin")).linkedinAdapter;
}

async function connect(
  overrides: Partial<Record<keyof typeof LINKEDIN_KEYS, string>> = {}
): Promise<void> {
  const { setCachedTokens } = await import("@/lib/publisher/tokens");
  await setCachedTokens({
    [LINKEDIN_KEYS.accessToken]: "li-access",
    [LINKEDIN_KEYS.accessExpiresAt]: String(Date.now() + 60 * DAY),
    [LINKEDIN_KEYS.scope]: "openid,profile,w_member_social",
    [LINKEDIN_KEYS.memberId]: "abc123",
    [LINKEDIN_KEYS.author]: MEMBER,
    ...Object.fromEntries(Object.entries(overrides).map(([key, value]) => [LINKEDIN_KEYS[key as keyof typeof LINKEDIN_KEYS], value]))
  });
}

function videoInput(overrides: Partial<PublishInput["item"]> = {}): PublishInput {
  return {
    item: testItem({
      platformIds: ["linkedin"],
      title: "Clip title",
      caption: "Shipped the new queue (finally) https://colateralai.com",
      hashtags: ["#buildinpublic"],
      visibility: "public",
      ...overrides
    }),
    localPath: videoPath
  };
}

function imageInput(count: number, overrides: Partial<PublishInput["item"]> = {}): PublishInput {
  const paths = imagePaths.slice(0, count);
  return {
    item: testItem({
      platformIds: ["linkedin"],
      mediaKind: "image",
      imagePaths: paths,
      clipPath: paths[0],
      title: "Deck title",
      caption: "Three things I learned",
      hashtags: [],
      visibility: "public",
      ...overrides
    }),
    localPath: paths[0],
    images: { localPaths: paths, publicUrls: [] }
  };
}

const postResponse = (id = "urn:li:share:7001") => new Response(null, { status: 201, headers: { "x-restli-id": id } });
type SentBody = {
  author: string;
  commentary: string;
  visibility: string;
  content?: unknown;
  initializeUploadRequest: { owner: string };
};
const body = (request: RecordedRequest) => JSON.parse(String(request.body)) as SentBody;
const find = (requests: RecordedRequest[], method: string, fragment: string) =>
  requests.find((request) => request.method === method && request.url.includes(fragment));

function imageRoutes(extra: Parameters<typeof mockFetchRoutes>[0] = []) {
  return mockFetchRoutes([
    ...extra,
    {
      match: "/rest/images?action=initializeUpload",
      respond: () =>
        jsonResponse({ value: { uploadUrl: "https://www.linkedin.com/dms-uploads/img-1", image: "urn:li:image:IMG1", uploadUrlExpiresAt: 1 } })
    },
    { match: "dms-uploads/img-1", respond: () => new Response(null, { status: 201 }) },
    { match: "/rest/images/urn%3Ali%3Aimage%3AIMG1", respond: () => jsonResponse({ status: "AVAILABLE" }) },
    { match: "/rest/posts", respond: () => postResponse() }
  ]);
}

describe("the disabled state", () => {
  it("is not configured without a client id and secret, and says what to set", async () => {
    vi.stubEnv("LINKEDIN_CLIENT_ID", "");
    vi.stubEnv("LINKEDIN_CLIENT_SECRET", "");
    const li = await adapter();
    expect(li.configured()).toBe(false);
    await expect(li.publish(videoInput())).rejects.toThrow("LINKEDIN_CLIENT_ID");
    await expect(li.validateAuth()).rejects.toThrow("LINKEDIN_CLIENT_SECRET");
  });

  it("is not configured with credentials until someone has signed in", async () => {
    const li = await adapter();
    expect(li.configured()).toBe(false);
    await expect(li.publish(videoInput())).rejects.toThrow("not connected");
  });

  it("is configured once signed in", async () => {
    await connect();
    expect((await adapter()).configured()).toBe(true);
  });

  it("makes no request while disabled", async () => {
    vi.stubEnv("LINKEDIN_CLIENT_ID", "");
    const requests = mockFetchRoutes([]);
    await (await adapter()).publish(videoInput()).catch(() => undefined);
    expect(requests).toHaveLength(0);
  });
});

describe("text posts with a link", () => {
  it("posts the commentary with the link as an article card", async () => {
    await connect();
    const requests = mockFetchRoutes([{ match: "/rest/posts", respond: () => postResponse("urn:li:share:555") }]);
    const { publishLinkedinText } = await import("@/lib/publisher/adapters/linkedin");

    const result = await publishLinkedinText({
      text: "A short update (with a link) #AI",
      link: { url: "https://colateralai.com/li", title: "CoLateral", description: "Engineering tools" },
      visibility: "public"
    });

    expect(result).toMatchObject({ status: "published", postId: "urn:li:share:555" });
    const request = requests[0];
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://api.linkedin.com/rest/posts");
    expect(request.headers).toMatchObject({
      Authorization: "Bearer li-access",
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json"
    });
    expect(request.headers["LinkedIn-Version"]).toMatch(/^\d{6}$/);
    expect(body(request)).toEqual({
      author: MEMBER,
      commentary: "A short update \\(with a link\\) {hashtag|\\#|AI}",
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { article: { source: "https://colateralai.com/li", title: "CoLateral", description: "Engineering tools" } },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false
    });
  });

  it("posts plain text when there is no link", async () => {
    await connect();
    const requests = mockFetchRoutes([{ match: "/rest/posts", respond: () => postResponse() }]);
    const { publishLinkedinText } = await import("@/lib/publisher/adapters/linkedin");
    await publishLinkedinText({ text: "Just words", visibility: "public" });
    expect(body(requests[0]).content).toBeUndefined();
  });
});

describe("a single image", () => {
  it("initialises the upload, PUTs the bytes, then posts the image URN", async () => {
    await connect();
    const requests = imageRoutes();

    const result = await (await adapter()).publish(imageInput(1));

    expect(result).toMatchObject({ status: "published", postId: "urn:li:share:7001", containerId: "urn:li:image:IMG1" });
    const init = find(requests, "POST", "/rest/images?action=initializeUpload")!;
    expect(body(init)).toEqual({ initializeUploadRequest: { owner: MEMBER } });
    const upload = find(requests, "PUT", "dms-uploads/img-1")!;
    expect(Buffer.isBuffer(upload.body)).toBe(true);
    expect(upload.headers.Authorization).toBe("Bearer li-access");
    expect(upload.headers["Content-Type"]).toBe("image/png");
    const post = body(find(requests, "POST", "/rest/posts")!);
    expect(post.author).toBe(MEMBER);
    expect(post.content).toEqual({ media: { title: "Deck title", id: "urn:li:image:IMG1" } });
    expect(post.commentary).toBe("Three things I learned");
    const order = requests.map((request) => `${request.method} ${new URL(request.url).pathname}`);
    expect(order.indexOf("POST /rest/images")).toBeLessThan(order.findIndex((entry) => entry.startsWith("PUT")));
    expect(order.findIndex((entry) => entry.startsWith("PUT"))).toBeLessThan(order.indexOf("POST /rest/posts"));
  });
});

describe("video", () => {
  function videoRoutes(status = "AVAILABLE") {
    return mockFetchRoutes([
      {
        match: "/rest/videos?action=initializeUpload",
        respond: () =>
          jsonResponse({
            value: {
              video: "urn:li:video:VID1",
              uploadToken: "tok-1",
              uploadInstructions: [
                { uploadUrl: "https://www.linkedin.com/dms-uploads/vid-part-1", firstByte: 0, lastByte: 5 },
                { uploadUrl: "https://www.linkedin.com/dms-uploads/vid-part-2", firstByte: 6, lastByte: 9 }
              ]
            }
          })
      },
      { match: "vid-part-1", respond: () => new Response(null, { status: 200, headers: { ETag: "etag-one" } }) },
      { match: "vid-part-2", respond: () => new Response(null, { status: 200, headers: { ETag: "etag-two" } }) },
      { match: "/rest/videos?action=finalizeUpload", respond: () => new Response(null, { status: 200 }) },
      { match: "/rest/videos/urn%3Ali%3Avideo%3AVID1", respond: () => jsonResponse({ status }) },
      { match: "/rest/posts", respond: () => postResponse("urn:li:ugcPost:9001") }
    ]);
  }

  it("uploads each part, finalises with the ETags, then posts the video", async () => {
    await connect();
    const requests = videoRoutes();
    const handles: string[] = [];

    const result = await (await adapter()).publish({ ...videoInput(), onHandle: async (handle) => void handles.push(handle) });

    expect(result).toMatchObject({ status: "published", postId: "urn:li:ugcPost:9001", containerId: "urn:li:video:VID1" });
    expect(body(find(requests, "POST", "/rest/videos?action=initializeUpload")!)).toEqual({
      initializeUploadRequest: { owner: MEMBER, fileSizeBytes: 10, uploadCaptions: false, uploadThumbnail: false }
    });
    const first = find(requests, "PUT", "vid-part-1")!;
    const second = find(requests, "PUT", "vid-part-2")!;
    expect((first.body as Buffer).toString()).toBe("012345");
    expect((second.body as Buffer).toString()).toBe("6789");
    expect(first.headers["Content-Type"]).toBe("application/octet-stream");
    expect(body(find(requests, "POST", "/rest/videos?action=finalizeUpload")!)).toEqual({
      finalizeUploadRequest: { video: "urn:li:video:VID1", uploadToken: "tok-1", uploadedPartIds: ["etag-one", "etag-two"] }
    });
    const post = body(find(requests, "POST", "/rest/posts")!);
    expect(post.content).toEqual({ media: { title: "Clip title", id: "urn:li:video:VID1" } });
    expect(post.commentary).toBe(
      `Shipped the new queue \\(finally\\) https://colateralai.com/li?c=${postCode("item1")}\n\n{hashtag|\\#|buildinpublic}`
    );
    expect(handles).toEqual(["urn:li:video:VID1"]);
  });

  it("keeps the video handle and resumes by polling instead of uploading again", async () => {
    await connect();
    videoRoutes("PROCESSING");
    const input = videoInput();

    const { StillProcessingError } = await http();
    const first = await (await adapter()).publish({ ...input, pollBudgetMs: 0 }).catch((error) => error);
    expect(first).toBeInstanceOf(StillProcessingError);
    expect((first as InstanceType<typeof StillProcessingError>).containerId).toBe("urn:li:video:VID1");

    const requests = videoRoutes("AVAILABLE");
    const resumed = await (await adapter()).publish({
      ...input,
      item: { ...input.item, platforms: { linkedin: { status: "uploaded", attempts: 1, containerId: "urn:li:video:VID1" } } }
    });

    expect(resumed).toMatchObject({ status: "published", postId: "urn:li:ugcPost:9001" });
    expect(requests.some((request) => request.url.includes("initializeUpload"))).toBe(false);
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
  });

  it("fails permanently when LinkedIn cannot process the video", async () => {
    await connect();
    videoRoutes("PROCESSING_FAILED");
    const { PermanentError } = await http();
    await expect((await adapter()).publish(videoInput())).rejects.toBeInstanceOf(PermanentError);
  });

  it("fails when a part upload returns no ETag", async () => {
    await connect();
    mockFetchRoutes([
      {
        match: "/rest/videos?action=initializeUpload",
        respond: () =>
          jsonResponse({
            value: { video: "urn:li:video:VID1", uploadToken: "", uploadInstructions: [{ uploadUrl: "https://www.linkedin.com/dms-uploads/vid-part-1", firstByte: 0, lastByte: 9 }] }
          })
      },
      { match: "vid-part-1", respond: () => new Response(null, { status: 200 }) }
    ]);
    await expect((await adapter()).publish(videoInput())).rejects.toThrow("ETag");
  });
});

describe("a carousel as a PDF document", () => {
  it("renders the slides into one PDF and posts it as a document", async () => {
    await connect();
    const build = vi.fn<(paths: string[], options?: { title?: string }) => Promise<Buffer>>(async () => Buffer.from("%PDF-1.4 stub deck"));
    vi.doMock("@/lib/carousels/pdf", () => ({ buildCarouselPdf: build }));
    const requests = mockFetchRoutes([
      {
        match: "/rest/documents?action=initializeUpload",
        respond: () =>
          jsonResponse({ value: { uploadUrl: "https://www.linkedin.com/dms-uploads/doc-1", document: "urn:li:document:DOC1", uploadUrlExpiresAt: 1 } })
      },
      { match: "dms-uploads/doc-1", respond: () => new Response(null, { status: 201 }) },
      { match: "/rest/documents/urn%3Ali%3Adocument%3ADOC1", respond: () => jsonResponse({ status: "AVAILABLE" }) },
      { match: "/rest/posts", respond: () => postResponse("urn:li:share:8001") }
    ]);

    const result = await (await adapter()).publish(imageInput(3));

    expect(result).toMatchObject({ status: "published", postId: "urn:li:share:8001", containerId: "urn:li:document:DOC1" });
    expect(build).toHaveBeenCalledWith(imagePaths, { title: "Deck title" });
    expect(body(find(requests, "POST", "/rest/documents?action=initializeUpload")!)).toEqual({
      initializeUploadRequest: { owner: MEMBER }
    });
    const upload = find(requests, "PUT", "dms-uploads/doc-1")!;
    expect((upload.body as Buffer).toString()).toBe("%PDF-1.4 stub deck");
    expect(upload.headers["Content-Type"]).toBe("application/pdf");
    expect(body(find(requests, "POST", "/rest/posts")!).content).toEqual({
      media: { title: "Deck title", id: "urn:li:document:DOC1" }
    });
  });
});

describe("the post text", () => {
  it("falls back to the title when the caption and hashtags are both empty", async () => {
    await connect();
    const requests = imageRoutes();
    await (await adapter()).publish(imageInput(1, { caption: "", hashtags: [], title: "Five things I learned" }));
    expect(body(find(requests, "POST", "/rest/posts")!).commentary).toBe("Five things I learned");
  });
});

describe("who the post is from", () => {
  it("posts as the member by default", async () => {
    await connect();
    const requests = imageRoutes();
    await (await adapter()).publish(imageInput(1));
    expect(body(find(requests, "POST", "/rest/posts")!).author).toBe(MEMBER);
  });

  it("posts as an organization page, and uploads the media as that page", async () => {
    await connect({ author: PAGE, scope: "openid,profile,w_member_social,w_organization_social" });
    const requests = imageRoutes();

    await (await adapter()).publish(imageInput(1));

    expect(body(find(requests, "POST", "/rest/images?action=initializeUpload")!).initializeUploadRequest.owner).toBe(PAGE);
    expect(body(find(requests, "POST", "/rest/posts")!).author).toBe(PAGE);
  });

  it("explains the missing scope instead of calling LinkedIn when a page is chosen without it", async () => {
    await connect({ author: PAGE });
    const requests = imageRoutes();
    await expect((await adapter()).publish(imageInput(1))).rejects.toThrow("w_organization_social");
    expect(requests).toHaveLength(0);
  });

  it("posts a private item to connections only for a member, and refuses it for a page", async () => {
    await connect();
    let requests = imageRoutes();
    await (await adapter()).publish(imageInput(1, { visibility: "private" }));
    expect(body(find(requests, "POST", "/rest/posts")!).visibility).toBe("CONNECTIONS");

    await connect({ author: PAGE, scope: "w_organization_social" });
    requests = imageRoutes();
    await expect((await adapter()).publish(imageInput(1, { visibility: "private" }))).rejects.toThrow("public");
    expect(requests).toHaveLength(0);
  });
});

describe("errors from LinkedIn", () => {
  async function failPost(status: number, headers: Record<string, string> = {}) {
    await connect();
    imageRoutes([{ match: "/rest/posts", respond: () => new Response(JSON.stringify({ message: "boom" }), { status, headers }) }]);
    return (await adapter()).publish(imageInput(1)).catch((error) => error);
  }

  it("treats a 429 as a throttle that waits for the limit to reset", async () => {
    const error = await failPost(429, { "Retry-After": "1800" });
    const { ThrottledError } = await http();
    expect(error).toBeInstanceOf(ThrottledError);
    expect((error as InstanceType<typeof ThrottledError>).retryAfterMinutes).toBe(30);
  });

  it("treats a 5xx as retryable", async () => {
    const error = await failPost(503);
    const { PermanentError, TransientError } = await http();
    expect(error).toBeInstanceOf(TransientError);
    expect(error).not.toBeInstanceOf(PermanentError);
  });

  it("sends a 401 to the platform-health auth breaker", async () => {
    const error = await failPost(401);
    const { PermanentError } = await http();
    expect(error).toBeInstanceOf(PermanentError);
    expect(isAuthFailure(error)).toBe(true);
  });

  it("keeps a duplicate-content 422 permanent and out of the breaker", async () => {
    const error = await failPost(422);
    const { PermanentError } = await http();
    expect(error).toBeInstanceOf(PermanentError);
    expect(isAuthFailure(error)).toBe(false);
  });

  it("fails clearly when the post is created but LinkedIn returns no id", async () => {
    await connect();
    imageRoutes([{ match: "/rest/posts", respond: () => new Response(null, { status: 201 }) }]);
    await expect((await adapter()).publish(imageInput(1))).rejects.toThrow("no post id");
  });
});

describe("the access token", () => {
  async function health(): Promise<PlatformHealthResponse> {
    const { GET } = await import("@/app/api/health/platforms/route");
    return (await GET()).json() as Promise<PlatformHealthResponse>;
  }

  it("refreshes an expired token with the refresh token and stores the new pair", async () => {
    await connect({
      accessExpiresAt: String(Date.now() - 1000),
      refreshToken: "li-refresh",
      refreshExpiresAt: String(Date.now() + 300 * DAY)
    });
    const requests = imageRoutes([
      {
        match: "/oauth/v2/accessToken",
        respond: () =>
          jsonResponse({ access_token: "li-access-2", expires_in: 5184000, refresh_token: "li-refresh-2", refresh_token_expires_in: 31536000 })
      }
    ]);

    await (await adapter()).publish(imageInput(1));

    const refresh = find(requests, "POST", "/oauth/v2/accessToken")!;
    const form = new URLSearchParams(String(refresh.body));
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("li-refresh");
    expect(form.get("client_id")).toBe("li-client");
    expect(form.get("client_secret")).toBe("li-secret");
    expect(find(requests, "POST", "/rest/posts")!.headers.Authorization).toBe("Bearer li-access-2");
    const { getCachedToken } = await import("@/lib/publisher/tokens");
    expect(await getCachedToken(LINKEDIN_KEYS.refreshToken)).toBe("li-refresh-2");
  });

  it("reads an expired token with no refresh token as a revoked connection the breaker recognises", async () => {
    await connect({ accessExpiresAt: String(Date.now() - 1000) });
    const requests = mockFetchRoutes([]);
    const error = await (await adapter()).publish(imageInput(1)).catch((caught) => caught);
    const { PermanentError } = await http();
    expect(error).toBeInstanceOf(PermanentError);
    expect((error as Error).message).toContain("expired or was revoked");
    expect(isAuthFailure(error)).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it("lists LinkedIn as broken when the refresh token is rejected", async () => {
    await connect({ accessExpiresAt: String(Date.now() - 1000), refreshToken: "li-refresh" });
    mockFetchRoutes([
      { match: "/oauth/v2/accessToken", respond: () => jsonResponse({ error: "invalid_grant", error_description: "The refresh token is invalid or expired." }, { status: 400 }) }
    ]);

    await expect((await adapter()).validateAuth()).rejects.toThrow("invalid_grant");

    expect(await health()).toMatchObject({
      ok: false,
      broken: [expect.objectContaining({ platform: "linkedin", accountId: "linkedin-primary", reason: expect.stringContaining("invalid_grant") })]
    });
  });

  it("validates a live token with the userinfo call", async () => {
    await connect();
    const requests = mockFetchRoutes([{ match: "/v2/userinfo", respond: () => jsonResponse({ sub: "abc123" }) }]);
    await (await adapter()).validateAuth();
    expect(requests[0].headers.Authorization).toBe("Bearer li-access");
  });
});

describe("the dry-run plan", () => {
  it("names the endpoint and the media step without any request", async () => {
    await connect();
    const requests = mockFetchRoutes([]);
    const li = await adapter();
    const plan = li.buildPlan(imageInput(3));
    expect(plan.platform).toBe("linkedin");
    expect(plan.endpoint).toContain("https://api.linkedin.com/rest/posts");
    expect(plan.payload).toMatchObject({ media: "document", pages: 3, author: MEMBER });
    expect(li.buildPlan(videoInput()).payload).toMatchObject({ media: "video" });
    expect(requests).toHaveLength(0);
  });
});
