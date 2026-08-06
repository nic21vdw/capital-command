// Cover art is the requirement that fails LATEST and loudest: Spotify accepts
// the feed, then rejects the show, and the reason arrives by email days later.
// So the size is checked here, before anything is uploaded, from the image's
// own header — no image library, and no trusting the browser that sent it.

export type ImageSize = { width: number; height: number; format: "png" | "jpeg" };

export const MIN_ARTWORK_PX = 1400;
export const MAX_ARTWORK_PX = 3000;

function readPngSize(bytes: Uint8Array): ImageSize | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20), format: "png" };
}

/** Walks the JPEG segment chain to the frame header, which is the only place the size lives. */
function readJpegSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    // Every SOFn carries the dimensions except the four that are not frames.
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7), format: "jpeg" };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}

export function readImageSize(bytes: Uint8Array): ImageSize | null {
  return readPngSize(bytes) ?? readJpegSize(bytes);
}

/** Why Spotify would reject this image as cover art. Empty means it is fine. */
export function artworkProblems(size: ImageSize | null): string[] {
  if (!size) return ["Cover art must be a PNG or JPEG image."];
  const problems: string[] = [];
  if (size.width !== size.height) {
    problems.push(`Cover art must be square — this one is ${size.width}×${size.height}.`);
  }
  const smallest = Math.min(size.width, size.height);
  const largest = Math.max(size.width, size.height);
  if (smallest < MIN_ARTWORK_PX) {
    problems.push(`Cover art must be at least ${MIN_ARTWORK_PX}px — this one is ${smallest}px.`);
  }
  if (largest > MAX_ARTWORK_PX) {
    problems.push(`Cover art must be at most ${MAX_ARTWORK_PX}px — this one is ${largest}px.`);
  }
  return problems;
}
