import { open, realpath, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { parseByteRange } from "@/lib/clipping/byte-range";

export type ExistingMediaSource = "source" | "clip_master" | "clip_preview" | "clip_ready" | "clip_edited" | "clip_poster" | "clip_export" | "scheduled_media";

/** Internal server grant. Never serialize this object or accept it from HTTP args. */
export type ProtectedMediaGrant = {
  dataRoot: string;
  relativePath: string;
  sourceType: ExistingMediaSource;
};
export type ProtectedMediaResolver = (authenticatedOwnerId: string, mediaId: string) => Promise<ProtectedMediaGrant | null>;

const MIME: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mkv": "video/x-matroska",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav"
};

export function isContainedMediaPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function allowedMediaType(file: string): string | undefined { return MIME[path.extname(file).toLowerCase()]; }

function safeRelative(value: string): boolean {
  return Boolean(value) && !path.isAbsolute(value) && !path.win32.isAbsolute(value)
    && !/[:\u0000-\u001f\u007f]/.test(value) && !value.split(/[\\/]/).some((part) => !part || part === "." || part === "..");
}

const PRIVATE_HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin" };
function unavailable(): Response { return new Response(null, { status: 404, headers: PRIVATE_HEADERS }); }
function signature(value: Awaited<ReturnType<FileHandle["stat"]>>): string {
  return `${value.dev}:${value.ino}:${value.size}:${value.mtimeMs}:${value.ctimeMs}`;
}

/**
 * The resolver must recheck authenticated owner -> approved record -> actual file
 * on EVERY request. No client filepath, URL fetch, content sniffing or store write.
 * Authorization precedes method/range/conditional handling, including HEAD.
 */
export function createProtectedMediaReader(config: { resolveMedia: ProtectedMediaResolver }) {
  return async (authenticatedOwnerId: string, mediaId: string, request: Request): Promise<Response> => {
    let grant: ProtectedMediaGrant | null;
    try {
      if (!authenticatedOwnerId.trim() || !mediaId || mediaId.length > 512) return unavailable();
      grant = await config.resolveMedia(authenticatedOwnerId, mediaId);
    } catch { return unavailable(); }
    if (!grant) return unavailable();
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { ...PRIVATE_HEADERS, allow: "GET, HEAD" } });
    if (!safeRelative(grant.relativePath)) return unavailable();
    const type = allowedMediaType(grant.relativePath);
    if (!type) return unavailable();
    let handle: FileHandle | undefined;
    try {
      const root = await realpath(grant.dataRoot);
      const requested = path.resolve(root, grant.relativePath);
      const file = await realpath(requested);
      if (!isContainedMediaPath(root, file) || allowedMediaType(file) !== type
        // Reject aliases below the configured data root as well: an in-root
        // junction must not redirect an owner's clip into another job's media.
        || path.relative(requested, file) !== "") return unavailable();
      // O_RDONLY only: keeping this descriptor binds the response to the checked file.
      handle = await open(file, "r");
      const info = await handle.stat();
      if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size <= 0) return unavailable();
      // Recheck the path after opening, defending symlink swaps around the open.
      if (await realpath(requested) !== file || signature(await stat(file)) !== signature(info)
        || signature(await handle.stat()) !== signature(info)) return unavailable();
      const headers: Record<string, string> = { ...PRIVATE_HEADERS, "content-type": type, "accept-ranges": "bytes", "content-disposition": "inline" };
      const rangeHeader = request.headers.get("range");
      // A mismatched If-Range sends the entire representation. No public validators
      // are emitted, so an If-Range value can never authorize a conditional read.
      const useRange = rangeHeader !== null && !request.headers.has("if-range");
      const range = useRange ? parseByteRange(rangeHeader, info.size) : { start: 0, end: info.size - 1 };
      if (!range) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${info.size}` } });
      headers["content-length"] = String(range.end - range.start + 1);
      if (useRange) headers["content-range"] = `bytes ${range.start}-${range.end}/${info.size}`;
      if (request.method === "HEAD") return new Response(null, { status: useRange ? 206 : 200, headers });
      let position = range.start;
      const ownedHandle = handle;
      handle = undefined;
      let closed = false;
      const close = async () => { if (!closed) { closed = true; await ownedHandle.close(); } };
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            if (position > range.end) { await close(); controller.close(); return; }
            const buffer = Buffer.allocUnsafe(Math.min(256 * 1024, range.end - position + 1));
            const { bytesRead } = await ownedHandle.read(buffer, 0, buffer.length, position);
            if (!bytesRead) { await close(); controller.error(new Error("Media is unavailable.")); return; }
            position += bytesRead;
            controller.enqueue(new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead));
          } catch { await close().catch(() => undefined); controller.error(new Error("Media is unavailable.")); }
        },
        async cancel() { await close(); }
      });
      return new Response(body, { status: useRange ? 206 : 200, headers });
    } catch { return unavailable(); }
    finally { await handle?.close().catch(() => undefined); }
  };
}
