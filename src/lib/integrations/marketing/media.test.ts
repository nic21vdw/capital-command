import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProtectedMediaReader, type ProtectedMediaGrant } from "./media";

let root: string;
let temporary: string[];
const owner = "synthetic-owner";
const mediaId = "clip:job-a:clip-a:clip_ready";
const request = (method = "GET", headers: Record<string, string> = {}) => new Request("https://site.invalid/protected-media", { method, headers });
let grant: ProtectedMediaGrant;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "marketing-media-")); temporary = [root];
  await mkdir(path.join(root, "clips", "outputs", "job-a"), { recursive: true });
  await writeFile(path.join(root, "clips", "outputs", "job-a", "ready.mp4"), "0123456789");
  grant = { dataRoot: root, relativePath: path.join("clips", "outputs", "job-a", "ready.mp4"), sourceType: "clip_ready" };
});
afterEach(async () => {
  for (const directory of temporary) {
    if (path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith("marketing-media-")) throw new Error("Unexpected cleanup target");
    await rm(directory, { recursive: true, force: true });
  }
});
const reader = () => createProtectedMediaReader({ resolveMedia: async (who, id) => who === owner && id === mediaId ? grant : null });

describe("protected existing media", () => {
  it("serves existing local bytes privately with GET and HEAD and never rewrites them", async () => {
    const api = reader();
    const response = await api(owner, mediaId, request());
    expect(response.status).toBe(200); expect(await response.text()).toBe("0123456789");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    const head = await api(owner, mediaId, request("HEAD"));
    expect(head.status).toBe(200); expect(await head.text()).toBe(""); expect(head.headers.get("content-length")).toBe("10");
    expect(await readFile(path.join(root, grant.relativePath), "utf8")).toBe("0123456789");
  });

  it.each([["bytes=2-5", "2345", "bytes 2-5/10"], ["bytes=-3", "789", "bytes 7-9/10"], ["bytes=7-", "789", "bytes 7-9/10"], ["bytes=8-99", "89", "bytes 8-9/10"]])("reuses single byte-range semantics: %s", async (range, expected, contentRange) => {
    const response = await reader()(owner, mediaId, request("GET", { range }));
    expect(response.status).toBe(206); expect(await response.text()).toBe(expected); expect(response.headers.get("content-range")).toBe(contentRange);
    const head = await reader()(owner, mediaId, request("HEAD", { range }));
    expect(head.status).toBe(206); expect(await head.text()).toBe(""); expect(head.headers.get("content-range")).toBe(contentRange);
  });

  it.each(["bytes=20-", "bytes=5-2", "bytes=0-1,4-5", "bytes=-0", "nonsense", "bytes=9007199254740993-"])("returns a private 416 for unusable authorized range %s", async (range) => {
    const response = await reader()(owner, mediaId, request("GET", { range }));
    expect(response.status).toBe(416); expect(response.headers.get("content-range")).toBe("bytes */10"); expect(await response.text()).toBe("");
  });

  it("authorizes each GET/HEAD before range, conditional and method handling, without leaking existence or size", async () => {
    const api = reader();
    for (const method of ["GET", "HEAD", "POST"]) {
      const denied = await api("other-owner", mediaId, request(method, { range: "bytes=99-", "if-none-match": "*" }));
      const missing = await api(owner, "unknown-record", request(method));
      expect(denied.status).toBe(404); expect(missing.status).toBe(404); expect([...denied.headers]).toEqual([...missing.headers]);
      expect(denied.headers.get("content-range")).toBeNull(); expect(denied.headers.get("content-length")).toBeNull();
    }
    const invalidMethod = await api(owner, mediaId, request("POST")); expect(invalidMethod.status).toBe(405);
    const conditional = await api(owner, mediaId, request("GET", { range: "bytes=2-3", "if-range": '"old"', "if-none-match": "*" }));
    expect(conditional.status).toBe(200); expect(await conditional.text()).toBe("0123456789");
  });

  it.each(["../outside.mp4", "C:\\private\\video.mp4", "/etc/secret.mp4", "clips/outputs/job-a/../ready.mp4", "clips/outputs/job-a/file.mp4:stream", "clips/outputs/job-a/evil.svg", "clips/outputs/job-a/missing.mp4"])("fails closed on unsafe grant paths %s", async (relativePath) => {
    grant.relativePath = relativePath;
    const response = await reader()(owner, mediaId, request());
    expect(response.status).toBe(404); expect(await response.text()).toBe(""); expect(response.headers.get("content-type")).toBeNull();
  });

  it("rejects non-files, empty files and contained-looking junctions that resolve outside the data root", async () => {
    grant.relativePath = path.join("clips", "outputs", "directory.mp4");
    await mkdir(path.join(root, grant.relativePath));
    expect((await reader()(owner, mediaId, request())).status).toBe(404);
    grant.relativePath = path.join("clips", "outputs", "empty.mp4");
    await writeFile(path.join(root, grant.relativePath), "");
    expect((await reader()(owner, mediaId, request())).status).toBe(404);
    const outside = await mkdtemp(path.join(tmpdir(), "marketing-media-outside-")); temporary.push(outside);
    await writeFile(path.join(outside, "private.mp4"), "hidden-outside-secret");
    await symlink(outside, path.join(root, "clips", "outputs", "escaped"), "junction");
    grant.relativePath = path.join("clips", "outputs", "escaped", "private.mp4");
    const response = await reader()(owner, mediaId, request());
    expect(response.status).toBe(404); expect(await response.text()).not.toContain("hidden-");
  });

  it("rejects an in-root junction into another job's private media", async () => {
    const other = path.join(root, "clips", "outputs", "other-job");
    await mkdir(other);
    await writeFile(path.join(other, "private.mp4"), "hidden-other-owner-media");
    await symlink(other, path.join(root, "clips", "outputs", "job-a", "alias"), "junction");
    grant.relativePath = path.join("clips", "outputs", "job-a", "alias", "private.mp4");
    const response = await reader()(owner, mediaId, request());
    expect(response.status).toBe(404); expect(await response.text()).toBe("");
  });

  it("rechecks revocation on every request and suppresses resolver exceptions", async () => {
    let allowed = true;
    const resolveMedia = vi.fn(async () => allowed ? grant : null);
    const api = createProtectedMediaReader({ resolveMedia });
    expect(await (await api(owner, mediaId, request())).text()).toBe("0123456789");
    allowed = false;
    expect((await api(owner, mediaId, request("HEAD"))).status).toBe(404);
    expect(resolveMedia).toHaveBeenCalledTimes(2);
    const throwing = createProtectedMediaReader({ resolveMedia: async () => { throw new Error("hidden-path-secret"); } });
    expect(await (await throwing(owner, mediaId, request())).text()).toBe("");
  });
});
