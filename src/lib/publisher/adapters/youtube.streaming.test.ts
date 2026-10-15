import { createReadStream, type ReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testItem } from "@/lib/publisher/test-helpers";
import type { PublishInput } from "@/lib/publisher/types";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) };
});

let directory: string;
let localPath: string;
const bytes = Buffer.from(Array.from({ length: 2048 }, (_, i) => Math.floor(i / 256)));
const session = "https://upload.example/stream-session";

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "youtube-streaming-"));
  localPath = path.join(directory, "master.mp4");
  await writeFile(localPath, bytes);
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

beforeEach(() => {
  vi.stubEnv("YOUTUBE_CLIENT_ID", "test-client");
  vi.stubEnv("YOUTUBE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("YOUTUBE_REFRESH_TOKEN", "test-refresh");
  vi.resetModules();
  vi.mocked(createReadStream).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function input(existing = false): PublishInput {
  const item = testItem({ visibility: "private", format: "long", platformIds: ["youtube"] });
  if (existing) item.platforms.youtube = { status: "pending", attempts: 1, containerId: session };
  return { item, localPath };
}

function installFetch(options: { resumeFrom?: number; completed?: boolean; failUpload?: boolean } = {}) {
  const uploads: ReadStream[] = [];
  const sent: Buffer[] = [];
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    const target = String(url);
    requests.push({ url: target, init });
    if (target.includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "access-token", expires_in: 3600 });
    }
    if (target.includes("uploadType=resumable")) {
      return Response.json({}, { headers: { location: session } });
    }
    if (target !== session) throw new Error("Unexpected test request");
    const headers = init?.headers as Record<string, string>;
    if (headers["Content-Range"] === "bytes */2048") {
      if (options.completed) return Response.json({ id: "already-uploaded" });
      return new Response(null, {
        status: 308,
        headers: options.resumeFrom ? { range: `bytes=0-${options.resumeFrom - 1}` } : {}
      });
    }
    const stream = init?.body as unknown as ReadStream;
    expect(stream).toBeInstanceOf((await import("node:fs")).ReadStream);
    uploads.push(stream);
    expect((init as RequestInit & { duplex?: string }).duplex).toBe("half");
    expect(init?.signal).toBeUndefined();
    if (options.failUpload) throw new TypeError("connection reset");
    for await (const chunk of stream) sent.push(Buffer.from(chunk));
    return Response.json({ id: "uploaded" });
  }));
  return { uploads, sent, requests };
}

describe("YouTube streaming media transfer", () => {
  it("streams a fresh long-form file after persisting its handle", async () => {
    const captured = installFetch();
    const request = input();
    request.onHandle = async (handle) => {
      expect(handle).toBe(session);
      expect(createReadStream).not.toHaveBeenCalled();
    };
    const adapter = (await import("./youtube")).youtubeAdapter;

    const result = await adapter.publish(request);

    expect(result.postId).toBe("uploaded");
    expect(Buffer.concat(captured.sent)).toEqual(bytes);
    expect(createReadStream).toHaveBeenCalledWith(localPath, { start: 0, end: 2047 });
    expect(captured.uploads[0].destroyed).toBe(true);
    const upload = captured.requests.at(-1)!.init!;
    expect((upload.headers as Record<string, string>)["Content-Length"]).toBe("2048");
  });

  it("opens only the remaining range after a partially accepted upload", async () => {
    const captured = installFetch({ resumeFrom: 1024 });
    const adapter = (await import("./youtube")).youtubeAdapter;

    await adapter.publish(input(true));

    expect(Buffer.concat(captured.sent)).toEqual(bytes.subarray(1024));
    expect(createReadStream).toHaveBeenCalledWith(localPath, { start: 1024, end: 2047 });
    const headers = captured.requests.at(-1)!.init!.headers as Record<string, string>;
    expect(headers["Content-Length"]).toBe("1024");
    expect(headers["Content-Range"]).toBe("bytes 1024-2047/2048");
    expect(captured.requests.some((request) => request.url.includes("uploadType=resumable"))).toBe(false);
  });

  it("adopts a completed session without opening the media", async () => {
    installFetch({ completed: true });
    const adapter = (await import("./youtube")).youtubeAdapter;

    expect((await adapter.publish(input(true))).postId).toBe("already-uploaded");
    expect(createReadStream).not.toHaveBeenCalled();
  });

  it("destroys the file stream on an early network rejection", async () => {
    const captured = installFetch({ failUpload: true });
    const adapter = (await import("./youtube")).youtubeAdapter;

    await expect(adapter.publish(input())).rejects.toThrow(/network error.*connection reset/);
    expect(captured.uploads).toHaveLength(1);
    expect(captured.uploads[0].destroyed).toBe(true);
    // Wait for the pending asynchronous open/close before removing the fixture.
    if (!captured.uploads[0].closed) {
      await new Promise<void>((resolve) => captured.uploads[0].once("close", resolve));
    }
  });
});
