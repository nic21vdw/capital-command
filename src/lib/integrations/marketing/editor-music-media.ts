import { createHash } from "node:crypto";
import { parseByteRange } from "@/lib/clipping/byte-range";

/** Trusted stored-project bytes only. Never accept this grant from a caller. */
export type StoredMusicRead = {
  format: "wav"; mimeType: "audio/wav"; demuxer: "wav";
  byteLength: number; sha256: string;
  copyBytes(): Buffer;
  verifyCurrent(): Promise<void>;
};

const MAX_BYTES = 8 * 1024 * 1024;
const PRIVATE_HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin", "vary": "Cookie, Authorization" };
const unavailable = () => new Response(null, { status: 404, headers: PRIVATE_HEADERS });

// This closure retains only this response's bounded defensive byte copy, never
// the resolved asset, original project, data URL, resolver or store.
function byteBody(bytes: Buffer, start: number, end: number) {
  let position = start;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (position > end) { controller.close(); return; }
      const next = Math.min(position + 256 * 1024, end + 1);
      controller.enqueue(new Uint8Array(bytes.buffer, bytes.byteOffset + position, next - position));
      position = next;
    },
    cancel() { position = end + 1; },
  });
}

/** No disk writes or URL/path arguments. Resolve the exact current owner grant on every request. */
export function createStoredMusicMediaReader(options: {
  resolveMusic(ownerId: string, mediaId: string): Promise<StoredMusicRead | null>;
}) {
  return async (ownerId: string, mediaId: string, request: Request): Promise<Response> => {
    try {
      if (!ownerId.trim() || !mediaId || mediaId.length > 512) return unavailable();
      const asset = await options.resolveMusic(ownerId, mediaId);
      if (!asset) return unavailable();
      if (!["GET", "HEAD"].includes(request.method)) {
        return new Response(null, { status: 405, headers: { ...PRIVATE_HEADERS, allow: "GET, HEAD" } });
      }
      if (asset.format !== "wav" || asset.mimeType !== "audio/wav" || asset.demuxer !== "wav"
        || !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 44 || asset.byteLength > MAX_BYTES
        || !/^[a-f0-9]{64}$/.test(asset.sha256)) return unavailable();
      const headers: Record<string, string> = { ...PRIVATE_HEADERS, "content-type": "audio/wav",
        "content-disposition": "inline", "accept-ranges": "bytes" };
      const rangeHeader = request.headers.get("range");
      const useRange = rangeHeader !== null && !request.headers.has("if-range");
      const range = useRange ? parseByteRange(rangeHeader, asset.byteLength) : { start: 0, end: asset.byteLength - 1 };
      // No condition/range response may bypass current owner/revision verification.
      await asset.verifyCurrent();
      if (!range) return new Response(null, { status: 416,
        headers: { ...headers, "content-range": `bytes */${asset.byteLength}` } });
      headers["content-length"] = String(range.end - range.start + 1);
      if (useRange) headers["content-range"] = `bytes ${range.start}-${range.end}/${asset.byteLength}`;
      if (request.method === "HEAD") return new Response(null, { status: useRange ? 206 : 200, headers });
      const bytes = asset.copyBytes();
      if (!Buffer.isBuffer(bytes) || bytes.length !== asset.byteLength
        || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) return unavailable();
      await asset.verifyCurrent();
      return new Response(byteBody(bytes, range.start, range.end), { status: useRange ? 206 : 200, headers });
    } catch { return unavailable(); }
  };
}
